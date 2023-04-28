const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label) {
  if (config.input.runnerHomeDir) {
    // If runner home directory is specified, we expect the actions-runner software (and dependencies)
    // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
    return [
      '#!/bin/bash',
      `cd "${config.input.runnerHomeDir}"`,
      'export RUNNER_ALLOW_RUNASROOT=1',
      `./config.sh --url ${config.github.url} --token ${githubRegistrationToken} --labels ${label}  --name ${label} --runnergroup default --work "${config.input.runnerHomeDir}" --replace`,
      './run.sh',
    ];
  } else {
    return [
      '#!/bin/bash',
      'cd /opt && mkdir actions-runner && cd actions-runner',
      'case $(uname -m) in aarch64|arm64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
      'case $(uname -a) in Darwin*) OS="osx" ;; Linux*) OS="linux" ;; esac && export RUNNER_OS=${OS}',
      'export VERSION="2.303.0"',
      'curl -O -L https://github.com/actions/runner/releases/download/v${VERSION}/actions-runner-${RUNNER_OS}-${RUNNER_ARCH}-${VERSION}.tar.gz',
      'export LC_ALL=en_US.UTF-8',
      'export LANG=en_EN.UTF-8',
      'tar xzf ./actions-runner-${RUNNER_OS}-${RUNNER_ARCH}-${VERSION}.tar.gz',
      'export RUNNER_ALLOW_RUNASROOT=1',
      `./config.sh --url ${config.github.url} --token ${githubRegistrationToken} --labels ${label} --name ${label} --runnergroup default --work $(pwd) --replace`,
      './run.sh',
    ];
  }
}

async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

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

  if (config.input.hostId) {
    params.Placement = {
      Tenancy: 'host',
      HostId: config.input.hostId
    }
  }

  try {
    const result = await ec2.runInstances(params).promise();
    const ec2InstanceId = result.Instances[0].InstanceId;
    core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
    return ec2InstanceId;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function terminateEc2Instance() {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [config.input.ec2InstanceId],
  };

  try {
    await ec2.terminateInstances(params).promise();
    core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstanceId} termination error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceId) {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [ec2InstanceId],
  };

  try {
    await ec2.waitFor('instanceRunning', params).promise();
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
  waitForInstanceRunning,
};
