const { EC2Client, RunInstancesCommand, TerminateInstancesCommand, waitUntilInstanceRunning } = require("@aws-sdk/client-ec2");
const core = require('@actions/core');
const config = require('./config');

const runnerVersion = '2.309.0'

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label) {
  core.info(`Building data script for ${config.input.ec2Os}`)

  if (config.input.ec2Os === 'windows') {
    // Name the instance the same as the label to avoid machine name conflicts in GitHub.
    if (config.input.runnerHomeDir) {
      // If runner home directory is specified, we expect the actions-runner software (and dependencies)
      // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
      return [
        '<powershell>',
        'cd "${config.input.runnerHomeDir}"',
        'echo "${config.input.preRunnerScript}" > pre-runner-script.ps1',
        '& pre-runner-script.bat',
        `./config.cmd --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --name ${label} --unattended`,
        './run.cmd',
        '</powershell>',
        '<persist>false</persist>',
      ]
    } else {
      return [
        '<powershell>',
        'mkdir actions-runner; cd actions-runner',
        'echo "${config.input.preRunnerScript}" > pre-runner-script.ps1',
        '& pre-runner-script.ps1',
        `Invoke-WebRequest -Uri https://github.com/actions/runner/releases/download/v${runnerVersion}/actions-runner-win-x64-${runnerVersion}.zip -OutFile actions-runner-win-x64-${runnerVersion}.zip`,
        `Add-Type -AssemblyName System.IO.Compression.FileSystem ; [System.IO.Compression.ZipFile]::ExtractToDirectory("$PWD/actions-runner-win-x64-${runnerVersion}.zip", "$PWD")`,
        `./config.cmd --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --name ${label} --unattended`,
        './run.cmd',
        '</powershell>',
        '<persist>false</persist>',
      ]
    }
  } else if (config.input.ec2Os === 'linux') {
  if (config.input.runnerHomeDir) {
    // If runner home directory is specified, we expect the actions-runner software (and dependencies)
    // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
    return [
      '#!/bin/bash',
      `cd "${config.input.runnerHomeDir}"`,
      `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
      'source pre-runner-script.sh',
      'export RUNNER_ALLOW_RUNASROOT=1',
      `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
      './run.sh',
    ];
  } else {
    return [
      '#!/bin/bash',
      'mkdir actions-runner && cd actions-runner',
      `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
      'source pre-runner-script.sh',
      'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
      'curl -O -L https://github.com/actions/runner/releases/download/v2.313.0/actions-runner-linux-${RUNNER_ARCH}-2.313.0.tar.gz',
      'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-2.313.0.tar.gz',
      'export RUNNER_ALLOW_RUNASROOT=1',
      `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
      './run.sh',
    ];
  }
  } else {
    core.error('Not supported ec2-os.');
    return []
  }
}

async function startEc2Instances(label, githubRegistrationToken) {
  const client = new EC2Client();

  const userData = buildUserDataScript(githubRegistrationToken, label);

  const numberOfInstances = config.input.numberOfInstances || 1;

  const params = {
    ImageId: config.input.ec2ImageId,
    InstanceType: config.input.ec2InstanceType,
    MinCount: numberOfInstances,
    MaxCount: numberOfInstances,
    UserData: Buffer.from(userData.join('\n')).toString('base64'),
    SubnetId: config.input.subnetId,
    SecurityGroupIds: [config.input.securityGroupId],
    IamInstanceProfile: { Name: config.input.iamRoleName },
    TagSpecifications: config.tagSpecifications,
  };

  const command = new RunInstancesCommand(params);

  try {
    const result = await client.send(command);
    const ec2InstanceIds = result.Instances.map(instance => instance.InstanceId);
    core.info(`AWS EC2 instance ${ec2InstanceIds} is started`);
    return ec2InstanceIds;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function terminateEc2Instances() {
  const client = new EC2Client();
  const ec2InstanceIds = JSON.parse(config.input.ec2InstanceIds);
  const params = {
    InstanceIds: ec2InstanceIds,
  };

  const command = new TerminateInstancesCommand(params);

  try {
    await client.send(command);
    core.info(`AWS EC2 instance ${config.input.ec2InstanceIds} is terminated`);

  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstanceIds} termination error`);
    throw error;
  }
}

async function waitForInstancesRunning(ec2InstanceIds) {
  const client = new EC2Client();

  const params = {
    InstanceIds: ec2InstanceIds,
  };

  try {
    await waitUntilInstanceRunning({client, maxWaitTime: 30, minDelay: 3}, params);
    core.info(`AWS EC2 instance ${ec2InstanceIds} is up and running`);
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceIds} initialization error`);
    throw error;
  }
}

module.exports = {
  startEc2Instances,
  terminateEc2Instances,
  waitForInstancesRunning,
};
