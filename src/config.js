const core = require('@actions/core');
const github = require('@actions/github');

class Config {
  constructor() {
    this.input = {
      mode: core.getInput('mode', { required: true }),
      githubToken: core.getInput('github-token', { required: true }),
      ec2ImageId: core.getInput('ec2-image-id', { required: false }),
      ec2InstanceType: core.getInput('ec2-instance-type', { required: false }),
      subnetId: core.getInput('subnet-id', { required: false }),
      securityGroupId: core.getInput('security-group-id', { required: false }),
      label: core.getInput('label', { required: false }),
      ec2InstanceId: core.getInput('ec2-instance-id', { required: false }),
      iamRoleName: core.getInput('iam-role-name', { required: false }),
      runnerHomeDir: core.getInput('runner-home-dir', { required: false }) || 'actions-runner',
      ec2LaunchTemplate: core.getInput('ec2-launch-template', { required: false }),
    };

    const tags = JSON.parse(core.getInput('aws-resource-tags'));
    this.tagSpecifications = null;
    if (tags.length > 0) {
      this.tagSpecifications = [{ResourceType: 'instance', Tags: tags}, {ResourceType: 'volume', Tags: tags}];
    }

    // the values of github.context.repo.owner and github.context.repo.repo are taken from
    // the environment variable GITHUB_REPOSITORY specified in "owner/repo" format and
    // provided by the GitHub Action on the runtime
    this.githubContext = {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
    };

    //
    // validate input
    //

    if (!this.input.mode) {
      throw new Error(`The 'mode' input is not specified`);
    }

    if (!this.input.githubToken) {
      throw new Error(`The 'github-token' input is not specified`);
    }

    if (this.input.mode === 'start') {
      if (!this.input.ec2LaunchTemplate && (!this.input.ec2ImageId || !this.input.ec2InstanceType || !this.input.subnetId || !this.input.securityGroupId)) {
        throw new Error(`Not all the required inputs are provided for the 'start' mode`);
      }
    } else if (this.input.mode === 'stop') {
      if (!this.input.label || !this.input.ec2InstanceId) {
        throw new Error(`Not all the required inputs are provided for the 'stop' mode`);
      }
    } else {
      throw new Error('Wrong mode. Allowed values: start, stop.');
    }
  }

  generateUniqueLabel() {
    return Math.random().toString(36).substr(2, 5);
  }
}

try {
  module.exports = new Config();
} catch (error) {
  core.error(error);
  core.setFailed(error.message);
}
