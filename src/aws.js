const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');

const runnerVersion = '2.291.1'

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label) {
  const userData = [];

  core.info(`Building data script for ${config.input.ec2BaseOs}`)

  if (config.input.ec2BaseOs === 'win-x64') {
    userData.push(
      '<powershell>',
    );

    if (config.input.runnerHomeDir) {
      userData.push(
        `cd "${config.input.runnerHomeDir}"`,
      );
    } else {
      userData.push(
        'mkdir actions-runner; cd actions-runner',
        `Invoke-WebRequest -Uri https://github.com/actions/runner/releases/download/v${runnerVersion}/actions-runner-${config.input.ec2BaseOs}-${runnerVersion}.zip -OutFile actions-runner-win-x64-${runnerVersion}.zip`,
        `Add-Type -AssemblyName System.IO.Compression.FileSystem ; [System.IO.Compression.ZipFile]::ExtractToDirectory("$PWD/actions-runner-${config.input.ec2BaseOs}-${runnerVersion}.zip", "$PWD")`,
      );
    }
    
    userData.push(
      `./config.cmd --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --unattended`,
      './run.cmd',
      '</powershell>',
      '<persist>false</persist>',
    );
  }
  else if (config.input.ec2BaseOs === 'linux-x64' || config.input.ec2BaseOs === 'linux-arm' || config.input.ec2BaseOs === 'linux-arm64'){
    userData.push(
      '#!/bin/bash',
    );

    if (config.input.runnerHomeDir) {
      userData.push(
        `cd "${config.input.runnerHomeDir}"`,
      );
    } else {
      userData.push(
        'mkdir actions-runner && cd actions-runner',
        `curl -O -L https://github.com/actions/runner/releases/download/v${runnerVersion}/actions-runner-${config.input.ec2BaseOs}-${runnerVersion}.tar.gz`,
        `tar xzf ./actions-runner-linux-${config.input.ec2BaseOs}-${runnerVersion}.tar.gz`,
      );
    }

    userData.push(
      'export RUNNER_ALLOW_RUNASROOT=1',
      'export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1',
      `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
      './run.sh',
    );
  } else {
    core.error('Not supported ec2-base-os.');
  }

  return userData;
}

async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

  const userData = buildUserDataScript(githubRegistrationToken, label);

  const userDataStr = Buffer.from(userData.join('\n'));
  core.info(`User Data String:\n ${userDataStr}`);

  const params = {
    ImageId: config.input.ec2ImageId,
    InstanceType: config.input.ec2InstanceType,
    MinCount: 1,
    MaxCount: 1,
    UserData: userDataStr.toString('base64'),
    SubnetId: config.input.subnetId,
    SecurityGroupIds: [config.input.securityGroupId],
    IamInstanceProfile: { Name: config.input.iamRoleName },
    TagSpecifications: config.tagSpecifications,
  };

  if (config.input.awsKeyPairName) {
    params['KeyName'] = config.input.awsKeyPairName
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
