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
    .then((data) => {
      core.info('EC2 instance is created');

      return {
        instanceId: data.Instances[0].InstanceId,
      };
    })
    .catch((error) => {
      core.error('EC2 instance creation error');

      throw error;
    });
}

module.exports = {
  runEc2Instance,
};
