const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');

function setOutput(label, ec2InstanceId) {
  core.setOutput('label', label);
  core.setOutput('ec2-instance-id', ec2InstanceId);
}
function setBatchOutput(instancesDetail) {
  core.setOutput('instancesDetail', instancesDetail);
}

async function startInstance() {
  const label = config.generateUniqueLabel();
  const githubRegistrationToken = await gh.getRegistrationToken();
  const ec2InstanceId = await aws.startEc2Instance(label, githubRegistrationToken);
  await aws.waitForInstanceRunning(ec2InstanceId);
  await gh.waitForRunnerRegistered(label);
  return {label, ec2InstanceId};
}

async function start() {
  const {label, ec2InstanceId} = await startInstance();
  setOutput(label, ec2InstanceId);
}

async function startBatch(names) {
  core.info(names);
  core.info(typeof(names))
  const namesArray = JSON.parse(names)
  core.info(typeof(namesArray))

  const instancesDetail = await Promise.allSettled(namesArray.map(start))
  core.info(instancesDetail)
  setBatchOutput(instancesDetail);
}

async function stop() {
  await aws.terminateEc2Instance();
  await gh.removeRunner();
}

(async function () {
  try {
    switch (config.input.mode) {
      case 'start' :
        await start();
        break;
      case 'stop':
        await stop();
        break;
      case 'start_batch':
        await startBatch(config.input.batchNames);
        break;
      default:
        core.error('Unsupported mode {config.input.mode}')
    }


  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
