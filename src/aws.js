const {
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
  waitUntilInstanceRunning,
  CreateFleetCommand,
  CreateLaunchTemplateCommand,
  DeleteLaunchTemplateCommand
} = require('@aws-sdk/client-ec2');

const core = require('@actions/core');
const config = require('./config');

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label) {
  let scriptContent;
  const cmd = `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --unattended ${config.input.disableEphemeralRunner ? '' : '--ephemeral'}`;

  if (config.input.runnerHomeDir) {
    // If runner home directory is specified, we expect the actions-runner software (and dependencies)
    // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
    scriptContent = [
      '#!/bin/bash',
      'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
      `cd "${config.input.runnerHomeDir}"`,
      `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
      'source pre-runner-script.sh',
      'export RUNNER_ALLOW_RUNASROOT=1',
      cmd
    ];
  } else {
    scriptContent = [
      '#!/bin/bash',
      'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
      'mkdir actions-runner && cd actions-runner',
      `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
      'source pre-runner-script.sh',
      'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
      `RUNNER_VERSION=$(curl -s "https://api.github.com/repos/actions/runner/releases/latest" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/' | tr -d "v")`,
      'curl -O -L https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz',
      'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz',
      'export RUNNER_ALLOW_RUNASROOT=1',
      cmd
    ];
  }

  if (config.input.runAsUser) {
    scriptContent.push(`chown -R ${config.input.runAsUser} .`);
  }

  if (config.input.runAsService) {
    scriptContent.push(`./svc.sh install ${config.input.runAsUser || ''}`);
    scriptContent.push('./svc.sh start');
  } else {
    scriptContent.push(`${config.input.runAsUser ? `su ${config.input.runAsUser} -c` : ''} ./run.sh`);
  }

  // Create MIME multipart format
  const boundary = '//';

  const mimeData = [
    'Content-Type: multipart/mixed; boundary="' + boundary + '"',
    'MIME-Version: 1.0',
    '',
    '--' + boundary,
    'Content-Type: text/x-shellscript; charset="us-ascii"',
    'MIME-Version: 1.0',
    'Content-Transfer-Encoding: 7bit',
    'Content-Disposition: attachment; filename="userdata.txt"',
    '',
    scriptContent.join('\n'),
    '',
    '--' + boundary + '--',
    ''
  ];

  return mimeData.join('\n');
}

function buildMarketOptions() {
  if (config.input.marketType !== 'spot') {
    return undefined;
  }

  return {
    MarketType: config.input.marketType,
    SpotOptions: {
      SpotInstanceType: 'one-time',
    },
  };
}

async function createEc2InstanceWithParams(imageId, subnetId, securityGroupId, label, githubRegistrationToken, region) {
  // If multiple instance types are provided, use EC2 Fleet (instant) to create an instance
  if (Array.isArray(config.input.ec2InstanceTypes) && config.input.ec2InstanceTypes.length > 0) {
    return await createEc2InstanceWithFleetParams(imageId, subnetId, securityGroupId, label, githubRegistrationToken, region);
  }

  // else, use RunInstances to create instance with fixed instance type
  // Region is always specified now, so we can directly use it
  const ec2ClientOptions = { region };
  const ec2 = new EC2Client(ec2ClientOptions);

  const userData = buildUserDataScript(githubRegistrationToken, label);
  core.info('Executing user data script: ' + userData.replace(githubRegistrationToken, '<redacted>'));

  const params = {
    ImageId: imageId,
    InstanceType: config.input.ec2InstanceType,
    MaxCount: 1,
    MinCount: 1,
    SecurityGroupIds: [securityGroupId],
    SubnetId: subnetId,
    UserData: Buffer.from(userData).toString('base64'),
    IamInstanceProfile: config.input.iamRoleName ? { Name: config.input.iamRoleName } : undefined,
    TagSpecifications: config.tagSpecifications,
    InstanceMarketOptions: buildMarketOptions(),
    MetadataOptions: Object.keys(config.input.metadataOptions).length > 0 ? config.input.metadataOptions : undefined,
  };

  if (config.input.ec2VolumeSize !== '' || config.input.ec2VolumeType !== '') {
    params.BlockDeviceMappings = [
      {
        DeviceName: config.input.ec2DeviceName,
        Ebs: {
          ...(config.input.ec2VolumeSize !== '' && { VolumeSize: config.input.ec2VolumeSize }),
          ...(config.input.ec2VolumeType !== '' && { VolumeType: config.input.ec2VolumeType }),
        },
      },
    ];
  }

  if (config.input.blockDeviceMappings.length > 0) {
    params.BlockDeviceMappings = config.input.blockDeviceMappings;
  }

  const result = await ec2.send(new RunInstancesCommand(params));
  const ec2InstanceId = result.Instances[0].InstanceId;
  return ec2InstanceId;
}

async function startEc2Instance(label, githubRegistrationToken) {
  core.info(`Attempting to start EC2 instance using ${config.availabilityZones.length} availability zone configuration(s)`);

  const errors = [];

  // Try each availability zone configuration in sequence
  for (let i = 0; i < config.availabilityZones.length; i++) {
    const azConfig = config.availabilityZones[i];
    // Region is now always specified in the availability zone config
    const region = azConfig.region;
    core.info(`Trying availability zone configuration ${i + 1}/${config.availabilityZones.length}`);
    core.info(`Using imageId: ${azConfig.imageId}, subnetId: ${azConfig.subnetId}, securityGroupId: ${azConfig.securityGroupId}, region: ${region}`);

    try {
      const ec2InstanceId = await createEc2InstanceWithParams(
        azConfig.imageId,
        azConfig.subnetId,
        azConfig.securityGroupId,
        label,
        githubRegistrationToken,
        region
      );

      core.info(`Successfully started AWS EC2 instance ${ec2InstanceId} using availability zone configuration ${i + 1} in region ${region}`);
      return { ec2InstanceId, region };
    } catch (error) {
      const errorMessage = `Failed to start EC2 instance with configuration ${i + 1} in region ${region}: ${error.message}`;
      core.warning(errorMessage);
      errors.push(errorMessage);

      // Continue to the next availability zone configuration
      continue;
    }
  }

  // If we've tried all configurations and none worked, throw an error
  core.error('All availability zone configurations failed');
  throw new Error(`Failed to start EC2 instance in any availability zone. Errors: ${errors.join('; ')}`);
}

async function terminateEc2Instance() {
  const ec2 = new EC2Client();

  const params = {
    InstanceIds: [config.input.ec2InstanceId]
  };

  try {
    await ec2.send(new TerminateInstancesCommand(params));
    core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstanceId} termination error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceId, region) {
  // Region is always provided now
  const ec2ClientOptions = { region };
  const ec2 = new EC2Client(ec2ClientOptions);

  core.info(`Using region ${region} for checking instance ${ec2InstanceId} status`);

  try {
    core.info(`Checking for instance ${ec2InstanceId} to be up and running`);
    await waitUntilInstanceRunning(
      {
        client: ec2,
        maxWaitTime: 300,
      },
      {
        Filters: [
          {
            Name: 'instance-id',
            Values: [ec2InstanceId],
          },
        ],
      },
    );

    core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
    throw error;
  }
}

async function createEc2InstanceWithFleetParams(imageId, subnetId, securityGroupId, label, githubRegistrationToken, region) {
  const ec2 = new EC2Client({ region });

  const overrides = (config.input.ec2InstanceTypes || []).map((type) => ({
    InstanceType: type,
    SubnetId: subnetId,
    // For Type='instant', allow AMI override so callers can pass ImageId without baking it into LT
    ...(imageId ? { ImageId: imageId } : {})
  }));

  // Prepare to ensure we have a Launch Template ID (create one if not provided)
  let launchTemplateId = config.input.launchTemplateId;
  let createdTemporaryLt = false;

  if (!launchTemplateId) {
    core.info('No launch template ID provided. Creating a temporary Launch Template...');

    const userData = buildUserDataScript(githubRegistrationToken, label);
    core.info('Executing user data script: ' + userData.replace(githubRegistrationToken, '<redacted>'));

    // Build LaunchTemplateData similar to RunInstances params
    const ltData = {
      SecurityGroupIds: [securityGroupId],
      UserData: Buffer.from(userData).toString('base64'),
      TagSpecifications: config.tagSpecifications
    };

    // Block device mappings (prefer explicit mappings if provided)
    if (config.input.blockDeviceMappings && config.input.blockDeviceMappings.length > 0) {
      ltData.BlockDeviceMappings = config.input.blockDeviceMappings;
    } else if (config.input.ec2VolumeSize !== '' || config.input.ec2VolumeType !== '') {
      ltData.BlockDeviceMappings = [
        {
          DeviceName: config.input.ec2DeviceName,
          Ebs: {
            ...(config.input.ec2VolumeSize !== '' && { VolumeSize: config.input.ec2VolumeSize }),
            ...(config.input.ec2VolumeType !== '' && { VolumeType: config.input.ec2VolumeType })
          }
        }
      ];
    }

    const ltName = `ec2-github-runner-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const createLtParams = {
      LaunchTemplateName: ltName,
      LaunchTemplateData: ltData
    };

    const createLtRes = await ec2.send(new CreateLaunchTemplateCommand(createLtParams));
    launchTemplateId = createLtRes.LaunchTemplate.LaunchTemplateId;
    createdTemporaryLt = true;
    core.info(`Created temporary Launch Template ${launchTemplateId} with name ${ltName}`);
  }

  const isSpot = config.input.marketType === 'spot';

  const fleetParams = {
    Type: 'instant',
    LaunchTemplateConfigs: [
      {
        LaunchTemplateSpecification: {
          LaunchTemplateId: launchTemplateId,
          Version: '$Latest'
        },
        Overrides: overrides
      }
    ],
    TargetCapacitySpecification: {
      TotalTargetCapacity: 1,
      DefaultTargetCapacityType: isSpot ? 'spot' : 'on-demand',
      SpotTargetCapacity: isSpot ? 1 : 0,
      OnDemandTargetCapacity: isSpot ? 0 : 1
    },
    SpotOptions: isSpot ? { AllocationStrategy: 'price-capacity-optimized' } : undefined
  };

  let ec2InstanceId;
  let ec2InstanceType;
  const fleetRes = await ec2.send(new CreateFleetCommand(fleetParams));

  // Try to extract instance ID from the response (Type='instant' should return Instances)
  if (Array.isArray(fleetRes.Instances)) {
    core.info(`EC2 Fleet returned ${fleetRes.Instances.length} instances`);
    for (const group of fleetRes.Instances) {
      if (Array.isArray(group.InstanceIds) && group.InstanceIds.length > 0) {
        ec2InstanceId = group.InstanceIds[0];
        ec2InstanceType = group.InstanceType;
        break;
      }
    }
  }

  if (!ec2InstanceId) {
    const errDetails = JSON.stringify({ Errors: fleetRes.Errors }, null, 2);
    throw new Error(`EC2 Fleet did not return an instance ID. Details: ${errDetails}`);
  }

  core.info(`Successfully started AWS EC2 instance ${ec2InstanceId} with type ${ec2InstanceType} via EC2 Fleet in region ${region}`);

  // clean up the temporary launch template if it was created
  if (createdTemporaryLt && launchTemplateId) {
    try {
      await ec2.send(new DeleteLaunchTemplateCommand({ LaunchTemplateId: launchTemplateId }));
      core.info(`Deleted temporary Launch Template ${launchTemplateId}`);
    } catch (e) {
      core.warning(`Failed to delete temporary Launch Template ${launchTemplateId}: ${e.message}`);
    }
  }
  return ec2InstanceId;
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning
};