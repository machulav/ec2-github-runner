const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');

function setOutput(label, ec2InstanceId) {
  core.setOutput('label', label);
  core.setOutput('ec2-instance-id', ec2InstanceId);
}

async function start() {
  const label = config.generateUniqueLabel();
  const githubRegistrationToken = await gh.getRegistrationToken();
  const ec2InstanceId = await aws.startEc2Instance(label, githubRegistrationToken);
  setOutput(label, ec2InstanceId);
  await aws.waitForInstanceRunning(ec2InstanceId);
  await gh.waitForRunnerRegistered(label);
}

async function stop() {
  await aws.terminateEc2Instance();
  await gh.removeRunner();
}

(async function () {
  const MAX_ATTEMPTS = Number.parseInt(core.getInput('max_attempts'));
  let attempt = 1;
  let hasSucceeded = false;
  do {
    try {
      config.input.mode === 'start' ? await start() : await stop();
      hasSucceeded = true;
    } catch (error) {
      attempt += 1;
      if (attempt === MAX_ATTEMPTS) {
        core.error('Max attempts exceeded');
        core.error(error);
        core.setFailed(error.message);
      } else {
        core.warning(`${error} - ${error.message}`);
        core.info(`Attempt ${attempt} of ${MAX_ATTEMPTS}`);
      }
    }
  } while (attempt < MAX_ATTEMPTS && !hasSucceeded);
})();
