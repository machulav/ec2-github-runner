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

async function startInstance(name, attempt = 0) {
  try {
    const label = config.generateUniqueLabel();
    const githubRegistrationToken = await gh.getRegistrationToken();
    const ec2InstanceId = await aws.startEc2Instance(label, githubRegistrationToken);
    await aws.waitForInstanceRunning(ec2InstanceId);
    await gh.waitForRunnerRegistered(label);
    return {name, label, ec2InstanceId};
  } catch (error) {
    if (attempt < 5) {
      await startInstance(name, attempt + 1)
    }
  }
}

async function start() {
  const {label, ec2InstanceId} = await startInstance();
  setOutput(label, ec2InstanceId);
}

async function startBatch(names) {
  core.info(names);
  const namesArray = JSON.parse(names);
  const instancesDetailPromises = await Promise.allSettled(namesArray.map(startInstance));
  const instancesDetail = instancesDetailPromises.map(promiseRetVal => promiseRetVal.value)
  core.info(JSON.stringify(instancesDetail));
  setBatchOutput(JSON.stringify(instancesDetail));
}

async function stopInstance({ec2InstanceId, label}) {
  core.info(`Stopping instance ${ec2InstanceId}`);
  await aws.terminateEc2Instance(ec2InstanceId);
  core.info(`Removing ${label} from Github`);
  await gh.removeRunner(label);
}

async function stopBatch(instancesDetail) {
  core.info(instancesDetail);
  const instancesDetailArray = JSON.parse(instancesDetail);
  await Promise.allSettled(instancesDetailArray.map(stopInstance));
}

async function stop() {
  await stopInstance({"ec2InstanceId": config.input.ec2InstanceId, "label": config.input.label});
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
      case 'stop_batch':
        await stopBatch(config.input.ec2InstancesDetail);
        break;
      default:
        core.error('Unsupported mode {config.input.mode}')
    }


  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
