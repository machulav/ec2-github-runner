const { EC2Client, RunInstancesCommand, TerminateInstancesCommand, GetConsoleOutputCommand, waitUntilInstanceRunning } = require('@aws-sdk/client-ec2');

const core = require('@actions/core');
const config = require('./config');

// Build the commands to run on the instance
function buildRunCommands(githubRegistrationToken, label) {
  // Common preamble: fail-fast, log capture, and instance metadata
  const preamble = [
    '#!/bin/bash',
    'LOGFILE=/tmp/runner-setup.log',
    'exec > >(tee -a "$LOGFILE") 2>&1',
    'set -e',
    'echo "[RUNNER] =========================================="',
    'echo "[RUNNER] Setup script started at $(date -u)"',
    'echo "[RUNNER] =========================================="',
    'echo "[RUNNER] Instance ID: $(curl -sf http://169.254.169.254/latest/meta-data/instance-id || echo unknown)"',
    'echo "[RUNNER] Instance type: $(curl -sf http://169.254.169.254/latest/meta-data/instance-type || echo unknown)"',
    'echo "[RUNNER] AMI ID: $(curl -sf http://169.254.169.254/latest/meta-data/ami-id || echo unknown)"',
    'echo "[RUNNER] Hostname: $(hostname)"',
    'echo "[RUNNER] Kernel: $(uname -r)"',
    'echo "[RUNNER] Disk usage:" && df -h',
    'echo "[RUNNER] Memory:" && free -h',
  ];

  let userData;
  if (config.input.runnerHomeDir) {
    core.info('Runner home directory is specified, so it is expected that the actions-runner software (and dependencies) are pre-installed in the AMI.');
    userData = [
      ...preamble,
      `echo "[RUNNER] Changing to runner home dir: ${config.input.runnerHomeDir}"`,
      `cd "${config.input.runnerHomeDir}"`,
      'echo "[RUNNER] Directory contents:" && ls -la',
      'echo "[RUNNER] Sourcing pre-runner script..."',
      'source /tmp/pre-runner-script.sh',
      'echo "[RUNNER] Pre-runner script completed"',
      'export RUNNER_ALLOW_RUNASROOT=1',
      `echo "[RUNNER] Configuring runner with label: ${label}, name: ec2-${label}"`,
      `echo "[RUNNER] Target repo: ${config.githubContext.owner}/${config.githubContext.repo}"`,
      `./config.sh --unattended --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --name ec2-${label} --replace`,
      'echo "[RUNNER] config.sh completed successfully"',
    ];
  } else {
    core.info('Runner home directory is not specified, so the latest actions-runner software will be downloaded and installed.');
    userData = [
      ...preamble,
      'echo "[RUNNER] Creating actions-runner directory"',
      'mkdir actions-runner && cd actions-runner',
      'echo "[RUNNER] Working directory: $(pwd)"',
      'echo "[RUNNER] Sourcing pre-runner script..."',
      'source /tmp/pre-runner-script.sh',
      'echo "[RUNNER] Pre-runner script completed"',
      'echo "[RUNNER] Detecting architecture..."',
      'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
      'echo "[RUNNER] Architecture: ${RUNNER_ARCH}"',
      'echo "[RUNNER] Fetching latest runner version from GitHub API..."',
      `RUNNER_VERSION=$(curl -s "https://api.github.com/repos/actions/runner/releases/latest" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/' | tr -d "v")`,
      'echo "[RUNNER] Runner version: v${RUNNER_VERSION}"',
      'echo "[RUNNER] Downloading runner tarball..."',
      'curl -O -L https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz',
      'echo "[RUNNER] Download complete. Extracting..."',
      'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz',
      'echo "[RUNNER] Extraction complete. Directory contents:" && ls -la',
      'export RUNNER_ALLOW_RUNASROOT=1',
      `echo "[RUNNER] Configuring runner with label: ${label}, name: ec2-${label}"`,
      `echo "[RUNNER] Target repo: ${config.githubContext.owner}/${config.githubContext.repo}"`,
      `./config.sh --unattended --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --name ec2-${label} --replace`,
      'echo "[RUNNER] config.sh completed successfully"',
    ];
  }
  if (config.input.runAsUser) {
    userData.push(`echo "[RUNNER] Changing ownership to user: ${config.input.runAsUser}"`);
    userData.push(`chown -R ${config.input.runAsUser} . 2>&1 || echo "[RUNNER] WARNING: some files could not be chowned (non-fatal)"`);
  }
  if (config.input.runAsService) {
    core.info('Runner will be started with service wrapper');
    userData.push('echo "[RUNNER] Installing runner as service..."');
    userData.push(`./svc.sh install ${config.input.runAsUser || ''}`);
    userData.push('echo "[RUNNER] Starting service..."');
    userData.push('./svc.sh start');
    userData.push('echo "[RUNNER] Service started. Checking status..."');
    userData.push('./svc.sh status || echo "[RUNNER] WARNING: svc.sh status returned non-zero"');
  } else {
    core.info('Runner will be started without service wrapper');
    userData.push('echo "[RUNNER] Starting runner with run.sh..."');
    if (config.input.runAsUser) {
      userData.push(`runuser -u ${config.input.runAsUser} -- ./run.sh`);
    } else {
      userData.push('./run.sh');
    }
    userData.push('echo "[RUNNER] run.sh exited with code $?"');
  }
  userData.push('echo "[RUNNER] =========================================="');
  userData.push('echo "[RUNNER] Setup script finished at $(date -u)"');
  userData.push('echo "[RUNNER] =========================================="');
  return userData;
}

// Build user data as a cloud-boothook (runs during cloud-init init stage,
// bypassing cloud_final_modules which may be empty on some AMIs)
function buildUserDataScript(githubRegistrationToken, label) {
  const runCommands = buildRunCommands(githubRegistrationToken, label);

  const lines = [];

  // cloud-boothook header — processed during init stage, not final stage
  lines.push('#cloud-boothook');
  lines.push('#!/bin/bash');
  lines.push('# Guard: only run once per boot');
  lines.push('[ -f /run/runner-setup-started ] && exit 0');
  lines.push('touch /run/runner-setup-started');
  lines.push('');

  // Write pre-runner script
  lines.push("cat > /tmp/pre-runner-script.sh << 'PRERUNNEREOF'");
  if (config.input.preRunnerScript) {
    lines.push(config.input.preRunnerScript);
  } else {
    lines.push('#!/bin/bash');
  }
  lines.push('PRERUNNEREOF');
  lines.push('chmod 755 /tmp/pre-runner-script.sh');
  lines.push('');

  // Install packages if specified
  if (config.input.packages && config.input.packages.length > 0) {
    const pkgList = config.input.packages.join(' ');
    lines.push(`echo "[BOOTHOOK] Installing packages: ${pkgList}"`);
    lines.push(`yum install -y ${pkgList} || apt-get install -y ${pkgList} || echo "[BOOTHOOK] WARNING: package installation failed"`);
  }

  // Write the setup script to /opt/ using heredoc (quoted delimiter = no variable expansion)
  lines.push("cat > /opt/runner-setup.sh << 'RUNNERSETUPEOF'");
  for (let i = 0; i < runCommands.length; i++) {
    lines.push(runCommands[i]);
  }
  lines.push('RUNNERSETUPEOF');
  lines.push('chmod 755 /opt/runner-setup.sh');
  lines.push('');

  // Execute setup in background so boothook returns quickly and doesn't block cloud-init
  lines.push('nohup /opt/runner-setup.sh &');

  const script = lines.join('\n') + '\n';

  core.info('User data script is built successfully');
  core.info(`User data script content:\n${script}`);

  return script;
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
  // Region is always specified now, so we can directly use it
  const ec2ClientOptions = { region };
  const ec2 = new EC2Client(ec2ClientOptions);

  const userData = buildUserDataScript(githubRegistrationToken, label);

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
    InstanceIds: [config.input.ec2InstanceId],
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

/**
 * Fetches the serial console output from an EC2 instance.
 * This captures boot logs, kernel messages, and user-data script output
 * (anything written to /dev/console).
 */
async function getInstanceConsoleOutput(ec2InstanceId, region) {
  const ec2 = new EC2Client({ region });
  try {
    core.info(`Fetching console output for instance ${ec2InstanceId}...`);
    const result = await ec2.send(new GetConsoleOutputCommand({
      InstanceId: ec2InstanceId,
      Latest: true,
    }));
    if (result.Output) {
      const decoded = Buffer.from(result.Output, 'base64').toString('utf-8');
      core.info(`Console output received: ${decoded.length} bytes`);
      return decoded;
    }
    core.info('Console output not yet available (empty response from EC2 API - this is normal during early boot)');
    return null;
  } catch (error) {
    core.warning(`Failed to fetch console output for ${ec2InstanceId}: ${error.message}`);
    return null;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
  getInstanceConsoleOutput,
};
