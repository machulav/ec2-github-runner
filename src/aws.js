const { EC2Client, RunInstancesCommand, TerminateInstancesCommand, waitUntilInstanceRunning } = require('@aws-sdk/client-ec2');

const core = require('@actions/core');
const config = require('./config');

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label) {
  let userData;
  const cmd = `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --unattended ${config.input.disableEphemeralRunner ? '' : '--ephemeral'}`;
  if (config.input.runnerHomeDir) {
    // If runner home directory is specified, we expect the actions-runner software (and dependencies)
    // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
    userData = [
      '#cloud-boothook',
      '#!/bin/bash',
      'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
      `cd "${config.input.runnerHomeDir}"`,
      `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
      'source pre-runner-script.sh',
      'export RUNNER_ALLOW_RUNASROOT=1',
      cmd
    ];
  } else {
    userData = [
      '#cloud-boothook',
      '#!/bin/bash',
      'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
      'mkdir actions-runner && cd actions-runner',
      `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
      'source pre-runner-script.sh',
      'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
      `curl -O -L https://github.com/actions/runner/releases/download/v${config.input.runnerVersion}/actions-runner-linux-\${RUNNER_ARCH}-${config.input.runnerVersion}.tar.gz`,
      `tar xzf ./actions-runner-linux-\${RUNNER_ARCH}-${config.input.runnerVersion}.tar.gz`,
      'export RUNNER_ALLOW_RUNASROOT=1',
      cmd
    ];
  }
  if (config.input.runAsUser) {
    userData.push(`chown -R ${config.input.runAsUser} .`);
  }
  if (config.input.runAsService) {
    userData.push(`./svc.sh install ${config.input.runAsUser || ''}`);
    userData.push('./svc.sh start');
  } else {
    userData.push(`${config.input.runAsUser ? `su ${config.input.runAsUser} -c` : ''} ./run.sh`);
  }
  return userData;
}

function buildMarketOptions() {
  if (config.input.marketType !== 'spot') {
    return undefined;
  }

  return {
    MarketType: config.input.marketType,
    SpotOptions: {
      SpotInstanceType: 'one-time'
    }
  };
}

async function createEc2InstanceWithParams(imageId, subnetId, securityGroupId, label, githubRegistrationToken, region) {
  // Region is always specified now, so we can directly use it
  const ec2ClientOptions = { region };
  const ec2 = new EC2Client(ec2ClientOptions);

  const userData = buildUserDataScript(githubRegistrationToken, label);
  core.info('Executing user data script: ' + userData.join('\n').replace(githubRegistrationToken, '<redacted>'));

  const params = {
    ImageId: imageId,
    InstanceType: config.input.ec2InstanceType,
    MaxCount: 1,
    MinCount: 1,
    SecurityGroupIds: [securityGroupId],
    SubnetId: subnetId,
    UserData: Buffer.from(userData.join('\n')).toString('base64'),
    IamInstanceProfile: config.input.iamRoleName ? { Name: config.input.iamRoleName } : undefined,
    TagSpecifications: config.tagSpecifications,
    InstanceMarketOptions: buildMarketOptions()
  };

  if (config.input.ec2VolumeSize !== '' || config.input.ec2VolumeType !== '') {
    params.BlockDeviceMappings = [
      {
        DeviceName: config.input.ec2DeviceName,
        Ebs: {
          ...(config.input.ec2VolumeSize !== '' && { VolumeSize: config.input.ec2VolumeSize }),
          ...(config.input.ec2VolumeType !== '' && { VolumeType: config.input.ec2VolumeType })
        }
      }
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
        maxWaitTime: 300
      },
      {
        Filters: [
          {
            Name: 'instance-id',
            Values: [ec2InstanceId]
          }
        ]
      }
    );

    core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
    throw error;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning
};
