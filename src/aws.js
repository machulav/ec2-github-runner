const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');

async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

  const userData = [
    '#!/bin/bash',
    'yum update -y',
    'amazon-linux-extras install -y docker',
    'sudo service docker start',
    '# Install Docker\n' +
    'yum install -y docker\n' +
    '\n' +
    '# Set iptables rules\n' +
    'echo \'net.ipv4.conf.all.route_localnet = 1\' >> /etc/sysctl.conf\n' +
    'sysctl -p /etc/sysctl.conf\n' +
    'iptables -t nat -A PREROUTING -p tcp -d 169.254.170.2 --dport 80 -j DNAT --to-destination 127.0.0.1:51679\n' +
    'iptables -t nat -A OUTPUT -d 169.254.170.2 -p tcp -m tcp --dport 80 -j REDIRECT --to-ports 51679\n' +
    '\n' +
    '# Write iptables rules to persist after reboot\n' +
    'iptables-save > /etc/sysconfig/iptables\n' +
    '\n' +
    '# Create directories for ECS agent\n' +
    'mkdir -p /var/log/ecs /var/lib/ecs/data /etc/ecs\n' +
    '\n' +
    '# Write ECS config file\n' +
    'cat << EOF > /etc/ecs/ecs.config\n' +
    'ECS_DATADIR=/data\n' +
    'ECS_ENABLE_TASK_IAM_ROLE=true\n' +
    'ECS_ENABLE_TASK_IAM_ROLE_NETWORK_HOST=true\n' +
    'ECS_LOGFILE=/log/ecs-agent.log\n' +
    'ECS_AVAILABLE_LOGGING_DRIVERS=["json-file","awslogs"]\n' +
    'ECS_LOGLEVEL=info\n' +
    'ECS_CLUSTER=default\n' +
    'EOF\n' +
    '\n' +
    '# Write systemd unit file\n' +
    'cat << EOF > /etc/systemd/system/docker-container@ecs-agent.service\n' +
    '[Unit]\n' +
    'Description=Docker Container %I\n' +
    'Requires=docker.service\n' +
    'After=cloud-final.service\n' +
    '\n' +
    '[Service]\n' +
    'Restart=always\n' +
    'ExecStartPre=-/usr/bin/docker rm -f %i \n' +
    'ExecStart=/usr/bin/docker run --name %i \\\n' +
    '--privileged \\\n' +
    '--restart=on-failure:10 \\\n' +
    '--volume=/var/run:/var/run \\\n' +
    '--volume=/var/log/ecs/:/log:Z \\\n' +
    '--volume=/var/lib/ecs/data:/data:Z \\\n' +
    '--volume=/etc/ecs:/etc/ecs \\\n' +
    '--net=host \\\n' +
    '--env-file=/etc/ecs/ecs.config \\\n' +
    'amazon/amazon-ecs-agent:latest\n' +
    'ExecStop=/usr/bin/docker stop %i\n' +
    '\n' +
    '[Install]\n' +
    'WantedBy=default.target\n' +
    'EOF\n' +
    '\n' +
    'systemctl enable docker-container@ecs-agent.service\n' +
    'systemctl start docker-container@ecs-agent.service',
    'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
    'mkdir /actions-runner && cd /actions-runner',
    'curl -O -L https://github.com/actions/runner/releases/download/v2.274.2/actions-runner-linux-x64-2.274.2.tar.gz',
    'tar xzf ./actions-runner-linux-x64-2.274.2.tar.gz',
    'useradd github',
    'sudo usermod -a -G docker github',
    'chown -R github:github /actions-runner',
    `su github -c "./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}"`,
    'su github -c "./run.sh"',
  ];

  const params = {
    ImageId: config.input.ec2ImageId,
    InstanceType: config.input.ec2InstanceType,
    MinCount: 1,
    MaxCount: 1,
    UserData: Buffer.from(userData.join('\n')).toString('base64'),
    SubnetId: config.input.subnetId,
    SecurityGroupIds: [config.input.securityGroupId]
  };
  core.info(JSON.stringify(params))

  try {
    const result = await ec2.runInstances(params).promise();
    const ec2InstanceId = result.Instances[0].InstanceId;
    core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
    return ec2InstanceId;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function terminateEc2Instance() {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [config.input.ec2InstanceId],
  };

  try {
    await ec2.terminateInstances(params).promise();
    core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstanceId} termination error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceId) {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [ec2InstanceId],
  };

  try {
    await ec2.waitFor('instanceRunning', params).promise();
    core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceId} init error`);
    throw error;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
};
