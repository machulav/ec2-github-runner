const aws = require('./aws');
const core = require('@actions/core');

(async function () {
  try {
    var ec2InstanceId = core.getState('ec2InstanceId');

    core.startGroup('AWS EC2 instance termination');
    await aws.terminateEc2Instance(ec2InstanceId);
    core.endGroup();
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
