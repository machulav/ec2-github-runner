const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');
const { sortByCreationDate } = require('./utils');

async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

  // User data scripts are run as the root user.
  // Docker and git are necessary for GitHub runner and should be pre-installed on the AMI.
  const userData = [
    '#!/bin/bash',
    'mkdir actions-runner && cd actions-runner',
    'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
    'curl -O -L https://github.com/actions/runner/releases/download/v2.278.0/actions-runner-linux-${RUNNER_ARCH}-2.278.0.tar.gz',
    'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-2.278.0.tar.gz',
    'export RUNNER_ALLOW_RUNASROOT=1',
    'export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1',
    `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
    './run.sh',
  ];

  if (!config.input.ec2ImageId) {
    const amiParams = {
      Filters: [
        ...config.input.ec2ImageFilters,
        {
          Name: 'state',
          Values: [
            'available'
          ]
        },
      ]
    };
    if (config.input.ec2ImageOwner) {
      amiParams.Owners = [ config.input.ec2ImageOwner ];
    }

    const result = await ec2.describeImages(amiParams).promise();
    if (result.Images.length === 0) {
      throw new Error('Unable to find AMI using passed filter');
    }
    sortByCreationDate(result);

    config.input.ec2ImageId = result.Images[0].ImageId;
  }

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

  let ec2InstanceId;
  try {
    const result = await ec2.runInstances(params).promise();
    ec2InstanceId = result.Instances[0].InstanceId;
    core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }

  if (config.input.eipAllocationId) {
    const params = {
      AllocationId: config.input.eipAllocationId,
      InstanceId: ec2InstanceId,
    };

    try {
      await ec2.associateAddress(params).promise();
    } catch (error) {
      core.warning(`Elastic IP association error, trying to proceed w/o EIP: ${error.name}`);
    }
  }

  return ec2InstanceId;
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
