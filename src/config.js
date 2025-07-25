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
      runInOrgRunner: core.getInput('run-runner-in-org') === 'true',
      ec2VolumeSize: core.getInput('ec2-volume-size'),
      ec2DeviceName: core.getInput('ec2-device-name'),
      ec2VolumeType: core.getInput('ec2-volume-type'),
      blockDeviceMappings: JSON.parse(core.getInput('block-device-mappings') || '[]'),
      availabilityZonesConfig: core.getInput('availability-zones-config'),
    };

    // Get the AWS_REGION environment variable
    this.defaultRegion = process.env.AWS_REGION;
    
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

    // Initialize availabilityZones as an empty array
    this.availabilityZones = [];

    if (this.input.mode === 'start') {
      // Parse availability zones config if provided
      if (this.input.availabilityZonesConfig) {
        try {
          this.availabilityZones = JSON.parse(this.input.availabilityZonesConfig);
          
          // Validate each availability zone configuration
          if (!Array.isArray(this.availabilityZones)) {
            throw new Error('availability-zones-config must be a JSON array');
          }
          
          this.availabilityZones.forEach((az, index) => {
            if (!az.imageId) {
              throw new Error(`Missing imageId in availability-zones-config at index ${index}`);
            }
            if (!az.subnetId) {
              throw new Error(`Missing subnetId in availability-zones-config at index ${index}`);
            }
            if (!az.securityGroupId) {
              throw new Error(`Missing securityGroupId in availability-zones-config at index ${index}`);
            }
            // Region is optional, will use the default if not specified
            if (!az.region) {
              az.region = this.defaultRegion;
            }
          });
        } catch (error) {
          throw new Error(`Failed to parse availability-zones-config: ${error.message}`);
        }
      }

      // Check for required instance type regardless of config method
      if (!this.input.ec2InstanceType) {
        throw new Error(`The 'ec2-instance-type' input is required for the 'start' mode.`);
      }

      // If no availability zones config provided, check for individual parameters
      if (this.availabilityZones.length === 0) {
        if (!this.input.ec2ImageId || !this.input.subnetId || !this.input.securityGroupId) {
          throw new Error(
            `Either provide 'availability-zones-config' or all of the following: 'ec2-image-id', 'subnet-id', 'security-group-id'`
          );
        }
        
        // Convert individual parameters to a single availability zone config
        this.availabilityZones.push({
          imageId: this.input.ec2ImageId,
          subnetId: this.input.subnetId,
          securityGroupId: this.input.securityGroupId,
          // Add default region when using legacy configuration
          region: this.defaultRegion
        });
        
        core.info('Using individual parameters as a single availability zone configuration');
      }

      if (this.marketType?.length > 0 && this.input.marketType !== 'spot') {
        throw new Error('Invalid `market-type` input. Allowed values: spot.');
      }
    } else if (this.input.mode === 'stop') {
      if (!this.input.ec2InstanceId) {
        throw new Error(`The 'ec2-instance-id' input is required for the 'stop' mode.`);
      }
      if (!this.input.label) {
        core.warning(`The 'label' input is not specified for the 'stop' mode. The runner will be removed by the 'ec2-instance-id' input.`);
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
