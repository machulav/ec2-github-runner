const core = require('@actions/core');
const github = require('@actions/github');

class Config {
  constructor() {
    this.input = {
      mode: core.getInput('mode'),
      githubToken: core.getInput('github-token'),
      ec2ImageId: core.getInput('ec2-image-id'),
      ec2InstanceType: core.getInput('ec2-instance-type'),
      subnetId: core.getInput('subnet-id'),
      securityGroupId: core.getInput('security-group-id'),
      label: core.getInput('label'),
      ec2InstanceId: core.getInput('ec2-instance-id'),
      iamRoleName: core.getInput('iam-role-name'),
      runnerHomeDir: core.getInput('runner-home-dir'),
      scope: core.getInput('scope'),
      hostId: core.getInput('host-id'),
    };

    this.GITHUB_SCOPES = {
      organization: {
        url: `https://github.com/${github.context.repo.owner}`,
        context: { owner: github.context.repo.owner },
        apiPath: `/orgs/${github.context.repo.owner}`
      },
      repository: {
        url: `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}`,
        apiPath: `/repos/${github.context.repo.owner}/${github.context.repo.repo}`,
        context: {
          owner: github.context.repo.owner,
          repo: github.context.repo.repo
        }
      }
    };

    const tags = JSON.parse(core.getInput('aws-resource-tags'));
    this.tagSpecifications = null;
    if (tags.length > 0) {
      this.tagSpecifications = [{ResourceType: 'instance', Tags: tags}, {ResourceType: 'volume', Tags: tags}];
    }

    this.github = this.GITHUB_SCOPES[this.input.scope];
    if (!this.github) {
      throw new Error(`The 'scope' input is not valid`);
    }

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
      if (!this.input.ec2ImageId || !this.input.ec2InstanceType || !this.input.subnetId || !this.input.securityGroupId) {
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

  generateLabel() {
    if (!this.input.label) {
      return Math.random().toString(36).substr(2, 5);
    }

    return this.input.label
  }
}

try {
  module.exports = new Config();
} catch (error) {
  core.error(error);
  core.setFailed(error.message);
}
