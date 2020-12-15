const aws = require('./aws');
const gh = require('./gh');
const core = require('@actions/core');

function setOutputValues(instanceId) {
  const label = core.getInput('label');

  core.setOutput('label', label);
  core.setOutput('instanceId', instanceId);
}

(async function () {
  try {
    const githubRegistrationToken = await gh.getRegistrationToken();
    const ec2InstanceData = await aws.runEc2Instance(githubRegistrationToken);

    setOutputValues(ec2InstanceData.instanceId);
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
