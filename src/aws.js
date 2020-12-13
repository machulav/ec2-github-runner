const AWS = require('aws-sdk');
const core = require('@actions/core');

function runEc2Instance() {
  const ec2 = new AWS.EC2();

  const params = {
    ImageId: core.getInput('ec2_image_id'),
    InstanceType: core.getInput('ec2_instance_type'),
    MinCount: 1,
    MaxCount: 1,
  };

  return ec2
    .runInstances(params)
    .promise()
    .then((res) => {
      return {
        instanceId: res.Instances[0].InstanceId,
      };
    });
}

module.exports = {
  runEc2Instance,
};
