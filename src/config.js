const core = require('@actions/core');
const github = require('@actions/github');

class Config {
  constructor() {
    this.input = {
      ec2ImageId: core.getInput('ec2-image-id'),
      ec2InstanceId: core.getInput('ec2-instance-id'),
      ec2InstanceType: core.getInput('ec2-instance-type'),
      githubToken: core.getInput('github-token'),
      iamRoleName: core.getInput('iam-role-name'),
      label: core.getInput('label'),
      marketType: core.getInput('market-type'),
      mode: core.getInput('mode'),
      preRunnerScript: core.getInput('pre-runner-script'),
      runnerHomeDir: core.getInput('runner-home-dir'),
      securityGroupId: core.getInput('security-group-id'),
      startupQuietPeriodSeconds: core.getInput('startup-quiet-period-seconds'),
      startupRetryIntervalSeconds: core.getInput('startup-retry-interval-seconds'),
      startupTimeoutMinutes: core.getInput('startup-timeout-minutes'),
      subnetId: core.getInput('subnet-id'),
      runAsService: core.getInput('run-runner-as-service') === 'true',
      runAsUser: core.getInput('run-runner-as-user'),
      ec2VolumeSize: core.getInput('ec2-volume-size'),
      ec2DeviceName: core.getInput('ec2-device-name'),
      ec2VolumeType: core.getInput('ec2-volume-type'),
      blockDeviceMappings: JSON.parse(core.getInput('block-device-mappings') || '[]')
    };

    const tags = JSON.parse(core.getInput('aws-resource-tags'));
    this.tagSpecifications = null;
    if (tags.length > 0) {
      this.tagSpecifications = [
        { ResourceType: 'instance', Tags: tags },
        { ResourceType: 'volume', Tags: tags },
      ];
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
      if (!this.input.ec2ImageId || !this.input.ec2InstanceType || !this.input.subnetId || !this.input.securityGroupId) {
        throw new Error(`Not all the required inputs are provided for the 'start' mode`);
      }

      if (this.marketType?.length > 0 && this.input.marketType !== 'spot') {
        throw new Error('Invalid `market-type` input. Allowed values: spot.');
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
