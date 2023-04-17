const { EC2Client, RunInstancesCommand, TerminateInstancesCommand, WaiterState, waitUntilInstanceRunning} = require('@aws-sdk/client-ec2');
const core = require('@actions/core');
const config = require('./config');

const runnerVersion = '2.299.1'

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
        `cd "${config.input.runnerHomeDir}"`,
        `./config.cmd --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --name ${label} --unattended`,
        './run.cmd',
        '</powershell>',
        '<persist>false</persist>',
      ]
    } else {
      return [
        '<powershell>',
        'mkdir actions-runner; cd actions-runner',
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
        'export RUNNER_ALLOW_RUNASROOT=1',
        `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
        './run.sh',
      ];
    } else {
      return [
        '#!/bin/bash',
        'mkdir actions-runner && cd actions-runner',
        'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
        'curl -O -L https://github.com/actions/runner/releases/download/v2.286.0/actions-runner-linux-${RUNNER_ARCH}-2.299.1.tar.gz',
        'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-2.299.1.tar.gz',
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

async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new EC2Client({});

  const userData = buildUserDataScript(githubRegistrationToken, label);

  const params = {
    ImageId: config.input.ec2ImageId,
    InstanceType: config.input.ec2InstanceType,
    MinCount: 1,
    MaxCount: 1,
    UserData: Buffer.from(userData.join('\n')).toString('base64'),
    SubnetId: config.input.subnetId,
    SecurityGroupIds: [config.input.securityGroupId],
    IamInstanceProfile: { Name: config.input.iamRoleName },
    TagSpecifications: config.tagSpecifications,
  };

  if (config.input.awsKeyPairName) {
    params['KeyName'] = config.input.awsKeyPairName
  }

  try {
    const result = await ec2.send(new RunInstancesCommand(params));
    const ec2InstanceId = result.Instances[0].InstanceId;
    core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
    return ec2InstanceId;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function terminateEc2Instance() {
  const ec2 = new EC2Client({});

  const params = {
    InstanceIds: [config.input.ec2InstanceId],
  };

  try {
    await ec2.send(new TerminateInstancesCommand(params));
    core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstanceId} termination error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceId) {
  const ec2 = new EC2Client({});

  const params = {
    InstanceIds: [ec2InstanceId],
  };

  try {
    await waitUntilInstanceRunning(ec2, params).then((waiter) => {
      if (waiter.state === WaiterState.SUCCESS) {
        core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
      } else {
        core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
        throw new Error('Instance did not transition to running state');
      }
    });
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
    throw error;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
};
