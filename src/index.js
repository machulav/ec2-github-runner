const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');

function setOutput(label, ec2InstanceIds) {
  core.setOutput('label', label);
  core.setOutput('ec2-instance-ids', ec2InstanceIds);
}

async function start() {
  const label = config.generateUniqueLabel();
  const githubRegistrationToken = await gh.getRegistrationToken();
  const ec2InstanceIds = await aws.startEc2Instance(label, githubRegistrationToken);
  setOutput(label, ec2InstanceIds);
  await aws.waitForInstanceRunning(ec2InstanceIds);
  await gh.waitForRunnerRegistered(label);
}

async function stop() {
  await aws.terminateEc2Instance();
  await gh.removeRunner();
}

(async function () {
  try {
    config.input.mode === 'start' ? await start() : await stop();
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
