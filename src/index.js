const aws = require('./aws');
const gh = require('./gh');
const core = require('@actions/core');

function setOutputAndState(label, ec2InstanceId) {
  // save action output
  core.setOutput('label', label);

  // save state for the cleanup script
  core.saveState('EC2_INSTANCE_ID', ec2InstanceId);
  core.saveState('LABEL', label);
}

function generateUniqueLabel() {
  return Math.random().toString(36).substr(2, 5);
}

(async function () {
  try {
    const githubContext = gh.getContext();
    const githubRegistrationToken = await gh.getRegistrationToken();
    const subnetId = core.getInput('subnet_id');
    const securityGroupId = core.getInput('security_group_id');
    const label = generateUniqueLabel();

    const ec2InstanceId = await aws.startEc2Instance(githubContext, githubRegistrationToken, subnetId, securityGroupId, label);
    await aws.waitForInstanceRunning(ec2InstanceId);
    await gh.waitForRunnerCreated(label);

    setOutputAndState(label, ec2InstanceId);
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
