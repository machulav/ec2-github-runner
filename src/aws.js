const AWS = require('aws-sdk');
const core = require('@actions/core');

async function createEc2Instance(githubContext, githubRegistrationToken, subnetId, securityGroupId, label) {
  const ec2 = new AWS.EC2();

  let userData = [
    '#!/bin/bash',
    'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
    'mkdir /actions-runner && cd /actions-runner',
    'curl -O -L https://github.com/actions/runner/releases/download/v2.274.2/actions-runner-linux-x64-2.274.2.tar.gz',
    'tar xzf ./actions-runner-linux-x64-2.274.2.tar.gz',
    'useradd github',
    'chown -R github:github /actions-runner',
    `su github -c "./config.sh --url https://github.com/${githubContext.owner}/${githubContext.repo} --token ${githubRegistrationToken} --labels ${label}"`,
    'su github -c "./run.sh"',
  ];

  const params = {
    ImageId: core.getInput('ec2_image_id'),
    InstanceType: core.getInput('ec2_instance_type'),
    MinCount: 1,
    MaxCount: 1,
    UserData: new Buffer(userData.join('\n')).toString('base64'),
    SubnetId: subnetId,
    SecurityGroupIds: [securityGroupId],
  };

  try {
    const result = await ec2.runInstances(params).promise();
    core.info('EC2 instance is created');
    return result.Instances[0].InstanceId;
  } catch (error) {
    core.error('EC2 instance creation error');
    throw error;
  }
}

async function terminateEc2Instance(ec2InstanceId) {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [ec2InstanceId],
  };

  try {
    await ec2.terminateInstances(params).promise();
    core.info('EC2 instance is terminated');
    return;
  } catch (error) {
    core.error('EC2 instance termination error');
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
    core.info('EC2 instance is up and running');
    return;
  } catch (error) {
    core.error('EC2 instance init error');
    throw error;
  }
}

module.exports = {
  createEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
};
