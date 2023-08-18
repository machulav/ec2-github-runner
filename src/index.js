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
  const ec2InstanceIds = await aws.startEc2Instances(label, githubRegistrationToken);
  setOutput(label, ec2InstanceIds);
  for (const id of ec2InstanceIds) {
    await aws.waitForInstanceRunning(id);
  }
  await gh.waitForRunnersRegistered(label);
}

async function stop() {
  const ec2InstanceIds = core.getInput('ec2-instance-ids');
  const ids = Array.from(JSON.parse(ec2InstanceIds));

  for (const id of ids) {
    await aws.terminateEc2Instance(id);
  }

  await gh.removeRunners();
}

(async function () {
  try {
    config.input.mode === 'start' ? await start() : await stop();
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();

