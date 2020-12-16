const aws = require('./aws');
const gh = require('./gh');
const core = require('@actions/core');

function setOutputAndState(label, instanceId) {
  core.setOutput('label', label);
  core.setOutput('instanceId', instanceId);

  core.saveState('instanceId', instanceId);
}

(async function () {
  try {
    core.startGroup('GitHub Registration Token receiving');
    const githubContext = gh.getContext();
    const githubRegistrationToken = await gh.getRegistrationToken();
    core.endGroup();

    const subnetId = core.getInput('subnet_id');
    const securityGroupId = core.getInput('security_group_id');
    const label = core.getInput('label');

    core.startGroup('AWS EC2 instance creation');
    const ec2InstanceId = await aws.createEc2Instance(githubContext, githubRegistrationToken, subnetId, securityGroupId, label);
    await aws.waitForInstanceRunning(ec2InstanceId);
    core.endGroup();

    setOutputAndState(label, ec2InstanceId);
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
