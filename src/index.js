const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');

function setOutput(label, ec2InstanceId, region) {
  core.setOutput('label', label);
  core.setOutput('ec2-instance-id', ec2InstanceId);
  core.setOutput('region', region);
}

async function start() {
  const label = config.input.label ? config.input.label : config.generateUniqueLabel();

  let githubRegistrationToken = null;
  let encodedJitConfig = null;

  if (config.input.useJit) {
    const jitConfig = await gh.getJitRunnerConfig(label);
    encodedJitConfig = jitConfig.encodedJitConfig;
    core.info(`JIT runner created with runner ID: ${jitConfig.runnerId}`);
  } else {
    githubRegistrationToken = await gh.getRegistrationToken();
  }

  const result = await aws.startEc2Instance(label, githubRegistrationToken, encodedJitConfig);
  const ec2InstanceId = result.ec2InstanceId;
  const region = result.region;

  // Set outputs
  setOutput(label, ec2InstanceId, region);

  // Wait for the instance to be running
  await aws.waitForInstanceRunning(ec2InstanceId, region);

  let pollCallback = null;

  if (config.input.runnerDebug) {
    // Track how much console output we've already printed to avoid duplicates
    let lastOutputLength = 0;

    // Poll callback: fetch EC2 serial console output and log any new content
    pollCallback = async () => {
      const output = await aws.getInstanceConsoleOutput(ec2InstanceId, region);
      if (output && output.length > lastOutputLength) {
        const newOutput = output.substring(lastOutputLength);
        core.info(`--- EC2 Console Output ---\n${newOutput}--- End Console Output ---`);
        lastOutputLength = output.length;
      }
    };
  }

  await gh.waitForRunnerRegistered(label, pollCallback);
}

async function stop() {
  await aws.terminateEc2Instance();

  if (config.input.useJit) {
    core.info('JIT runner auto-deregisters after job completion. Skipping runner removal.');
  } else {
    await gh.removeRunner();
  }
}

(async function () {
  try {
    config.input.mode === 'start' ? await start() : await stop();
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
