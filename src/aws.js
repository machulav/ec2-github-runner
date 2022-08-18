const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label) {
  return [
    '#!/bin/bash',
    `if [ ! -d "${config.input.runnerHomeDir}" ]; then`,
    `  mkdir -p "${config.input.runnerHomeDir}" && cd "${config.input.runnerHomeDir}"`,
    '  case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
    '  curl -O -L https://github.com/actions/runner/releases/download/v2.286.0/actions-runner-linux-${RUNNER_ARCH}-2.286.0.tar.gz',
    '  tar xzf ./actions-runner-linux-${RUNNER_ARCH}-2.286.0.tar.gz',
    '  cd -',
    'fi',
    `cd ${config.input.runnerHomeDir}`,
    'export RUNNER_ALLOW_RUNASROOT=1',
    `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
    './run.sh',
  ];
}

async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

  const userData = buildUserDataScript(githubRegistrationToken, label);

  const params = Object.assign({},
    config.input.ec2ImageId && { ImageId: config.input.ec2ImageId },
    config.input.ec2InstanceType && { InstanceType: config.input.ec2InstanceType },
    config.input.subnetId && { SubnetId: config.input.subnetId },
    config.input.securityGroupId && { SecurityGroupIds: [config.input.securityGroupId] },
    config.input.iamRoleName && { IamInstanceProfile: { Name: config.input.iamRoleName } },
    config.tagSpecifications && { TagSpecifications: config.tagSpecifications },
    config.input.ec2LaunchTemplate && { LaunchTemplate: { LaunchTemplateName: config.input.ec2LaunchTemplate } },

    { UserData: Buffer.from(userData.join('\n')).toString('base64') },
    { MinCount: 1} ,
    { MaxCount: 1 },
  );

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
