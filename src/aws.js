const { EC2Client, RunInstancesCommand, TerminateInstancesCommand, GetConsoleOutputCommand, waitUntilInstanceRunning } = require('@aws-sdk/client-ec2');

const core = require('@actions/core');
const config = require('./config');

// Build the commands to run on the instance
function buildRunCommands(githubRegistrationToken, label) {
  const debug = config.input.runnerDebug;

  // Helper: only include a command when debug is enabled
  const dbg = (cmd) => debug ? cmd : null;

  // Common preamble: fail-fast and log capture
  const preamble = [
    '#!/bin/bash',
    'LOGFILE=/tmp/runner-setup.log',
    'exec > >(tee -a "$LOGFILE") 2>&1',
    'set -e',
    dbg('echo "[RUNNER] =========================================="'),
    dbg('echo "[RUNNER] Setup script started at $(date -u)"'),
    dbg('echo "[RUNNER] =========================================="'),
    dbg('echo "[RUNNER] Instance ID: $(curl -sf http://169.254.169.254/latest/meta-data/instance-id || echo unknown)"'),
    dbg('echo "[RUNNER] Instance type: $(curl -sf http://169.254.169.254/latest/meta-data/instance-type || echo unknown)"'),
    dbg('echo "[RUNNER] AMI ID: $(curl -sf http://169.254.169.254/latest/meta-data/ami-id || echo unknown)"'),
    dbg('echo "[RUNNER] Hostname: $(hostname)"'),
    dbg('echo "[RUNNER] Kernel: $(uname -r)"'),
    dbg('echo "[RUNNER] Disk usage:" && df -h'),
    dbg('echo "[RUNNER] Memory:" && free -h'),
  ].filter(Boolean);

  let userData;
  if (config.input.runnerHomeDir) {
    core.info('Runner home directory is specified, so it is expected that the actions-runner software (and dependencies) are pre-installed in the AMI.');
    userData = [
      ...preamble,
      dbg(`echo "[RUNNER] Changing to runner home dir: ${config.input.runnerHomeDir}"`),
      `cd "${config.input.runnerHomeDir}"`,
      dbg('echo "[RUNNER] Directory contents:" && ls -la'),
      dbg('echo "[RUNNER] Sourcing pre-runner script..."'),
      'source /tmp/pre-runner-script.sh',
      dbg('echo "[RUNNER] Pre-runner script completed"'),
      'export RUNNER_ALLOW_RUNASROOT=1',
      // Remove stale runner config from AMI so config.sh doesn't refuse to run
      'rm -f .runner .credentials .credentials_rsaparams',
      dbg(`echo "[RUNNER] Configuring runner with label: ${label}, name: ec2-${label}"`),
      `./config.sh --unattended --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --name ec2-${label} --replace`,
      dbg('echo "[RUNNER] config.sh completed successfully"'),
    ].filter(Boolean);
  } else {
    core.info('Runner home directory is not specified, so the latest actions-runner software will be downloaded and installed.');
    userData = [
      ...preamble,
      dbg('echo "[RUNNER] Creating actions-runner directory"'),
      'mkdir actions-runner && cd actions-runner',
      dbg('echo "[RUNNER] Working directory: $(pwd)"'),
      dbg('echo "[RUNNER] Sourcing pre-runner script..."'),
      'source /tmp/pre-runner-script.sh',
      dbg('echo "[RUNNER] Pre-runner script completed"'),
      dbg('echo "[RUNNER] Detecting architecture..."'),
      'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
      dbg('echo "[RUNNER] Architecture: ${RUNNER_ARCH}"'),
      dbg('echo "[RUNNER] Fetching latest runner version from GitHub API..."'),
      `RUNNER_VERSION=$(curl -s "https://api.github.com/repos/actions/runner/releases/latest" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/' | tr -d "v")`,
      dbg('echo "[RUNNER] Runner version: v${RUNNER_VERSION}"'),
      dbg('echo "[RUNNER] Downloading runner tarball..."'),
      'curl -O -L https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz',
      dbg('echo "[RUNNER] Download complete. Extracting..."'),
      'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz',
      dbg('echo "[RUNNER] Extraction complete. Directory contents:" && ls -la'),
      'export RUNNER_ALLOW_RUNASROOT=1',
      dbg(`echo "[RUNNER] Configuring runner with label: ${label}, name: ec2-${label}"`),
      `./config.sh --unattended --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --name ec2-${label} --replace`,
      dbg('echo "[RUNNER] config.sh completed successfully"'),
    ].filter(Boolean);
  }
  if (config.input.runAsUser) {
    userData.push(`chown -R ${config.input.runAsUser} . 2>&1 || true`);
  }
  if (config.input.runAsService) {
    core.info('Runner will be started with service wrapper');
    userData.push(`./svc.sh install ${config.input.runAsUser || ''}`);
    userData.push('./svc.sh start');
    userData.push(dbg('./svc.sh status || echo "[RUNNER] WARNING: svc.sh status returned non-zero"'));
  } else {
    core.info('Runner will be started without service wrapper');
    if (config.input.runAsUser) {
      userData.push(`runuser -u ${config.input.runAsUser} -- ./run.sh`);
    } else {
      userData.push('./run.sh');
    }
  }
  if (debug) {
    userData.push('echo "[RUNNER] =========================================="');
    userData.push('echo "[RUNNER] Setup script finished at $(date -u)"');
    userData.push('echo "[RUNNER] =========================================="');
  }
  return userData.filter(Boolean);
}

// Build the commands to run on the instance for JIT mode.
// JIT runners skip config.sh entirely and pass the encoded config directly to run.sh.
function buildJitRunCommands(encodedJitConfig) {
  const debug = config.input.runnerDebug;
  const dbg = (cmd) => debug ? cmd : null;

  // Common preamble: fail-fast and log capture
  const preamble = [
    '#!/bin/bash',
    'LOGFILE=/tmp/runner-setup.log',
    'exec > >(tee -a "$LOGFILE") 2>&1',
    'set -e',
    dbg('echo "[RUNNER] =========================================="'),
    dbg('echo "[RUNNER] JIT Setup script started at $(date -u)"'),
    dbg('echo "[RUNNER] =========================================="'),
  ].filter(Boolean);

  let userData;
  if (config.input.runnerHomeDir) {
    userData = [
      ...preamble,
      `cd "${config.input.runnerHomeDir}"`,
      'source /tmp/pre-runner-script.sh',
      'export RUNNER_ALLOW_RUNASROOT=1',
      // Remove stale runner config from AMI so run.sh doesn't get confused
      'rm -f .runner .credentials .credentials_rsaparams',
    ];
  } else {
    userData = [
      ...preamble,
      'mkdir actions-runner && cd actions-runner',
      'source /tmp/pre-runner-script.sh',
      'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
      `RUNNER_VERSION=$(curl -s "https://api.github.com/repos/actions/runner/releases/latest" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/' | tr -d "v")`,
      'curl -O -L https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz',
      'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz',
      'export RUNNER_ALLOW_RUNASROOT=1',
    ];
  }

  if (config.input.runAsUser) {
    userData.push(`chown -R ${config.input.runAsUser} . 2>&1 || true`);
    userData.push(`runuser -u ${config.input.runAsUser} -- ./run.sh --jitconfig ${encodedJitConfig}`);
  } else {
    userData.push(`./run.sh --jitconfig ${encodedJitConfig}`);
  }

  return userData;
}

// Build cloud-init YAML user data
function buildUserDataScript(githubRegistrationToken, label, encodedJitConfig) {
  // 1. Get the list of shell commands (keep your new buildRunCommands logic!)
  const runCommands = encodedJitConfig
    ? buildJitRunCommands(encodedJitConfig)
    : buildRunCommands(githubRegistrationToken, label);

  // 2. Start the YAML content
  let yamlContent = '#cloud-config\n';

  // 3. Add packages if specified
  if (config.input.packages && config.input.packages.length > 0) {
    yamlContent += 'packages:\n';
    config.input.packages.forEach(pkg => {
      yamlContent += `  - ${pkg}\n`;
    });
  }

  // 4. write_files section
  yamlContent += 'write_files:\n';

  // Write pre-runner script
  yamlContent += '  - path: /tmp/pre-runner-script.sh\n';
  yamlContent += '    permissions: "0755"\n';
  yamlContent += '    content: |\n';
  if (config.input.preRunnerScript) {
    // Indent the script content for YAML
    config.input.preRunnerScript.split('\n').forEach(line => {
      yamlContent += `      ${line}\n`;
    });
  } else {
    yamlContent += '      #!/bin/bash\n';
  }

  // Write main setup script
  yamlContent += '  - path: /opt/runner-setup.sh\n';
  yamlContent += '    permissions: "0755"\n';
  yamlContent += '    content: |\n';

  // Add each line of the command list (from buildRunCommands)
  runCommands.forEach(line => {
    yamlContent += `      ${line}\n`;
  });

  // 5. runcmd section - This runs AFTER Docker is up
  yamlContent += 'runcmd:\n';
  // We still use nohup just in case cloud-init kills the process group,
  // but now the environment is fully ready.
  yamlContent += '  - nohup /opt/runner-setup.sh &\n';

  return yamlContent;
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

async function createEc2InstanceWithParams(imageId, subnetId, securityGroupId, label, githubRegistrationToken, region, encodedJitConfig) {
  // Region is always specified now, so we can directly use it
  const ec2ClientOptions = { region };
  const ec2 = new EC2Client(ec2ClientOptions);

  const userData = buildUserDataScript(githubRegistrationToken, label, encodedJitConfig);

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

async function startEc2Instance(label, githubRegistrationToken, encodedJitConfig) {
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
        region,
        encodedJitConfig
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
    if (config.input.runnerDebug) {
      core.info(`Fetching console output for instance ${ec2InstanceId}...`);
    }
    const result = await ec2.send(new GetConsoleOutputCommand({
      InstanceId: ec2InstanceId,
      Latest: true,
    }));
    if (result.Output) {
      const decoded = Buffer.from(result.Output, 'base64').toString('utf-8');
      if (config.input.runnerDebug) {
        core.info(`Console output received: ${decoded.length} bytes`);
      }
      return decoded;
    }
    if (config.input.runnerDebug) {
      core.info('Console output not yet available (empty response from EC2 API - this is normal during early boot)');
    }
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
  // Exposed for testing only
  _buildUserDataScriptForTest: buildUserDataScript,
};
