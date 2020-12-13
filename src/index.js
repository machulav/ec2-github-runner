const aws = require('./aws');
const core = require('@actions/core');

function setOutputValues(label, instanceId) {
  core.setOutput('label', label);
  core.setOutput('instanceId', instanceId);
}

(async function () {
  try {
    const ec2InstanceData = await aws.runEc2Instance();

    const label = core.getInput('label');
    setOutputValues(label, ec2InstanceData.instanceId);
  } catch (error) {
    console.log(error);
    core.setFailed(error.message);
  }
})();
