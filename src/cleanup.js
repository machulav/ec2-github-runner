const aws = require('./aws');
const gh = require('./gh');
const core = require('@actions/core');

(async function () {
  try {
    var ec2InstanceId = core.getState('EC2_INSTANCE_ID');
    var label = core.getState('LABEL');

    await aws.terminateEc2Instance(ec2InstanceId);
    await gh.removeRunner(label);
  } catch (error) {
    console.log(error);
    core.error(error);
    core.setFailed(error.message);
  }
})();
