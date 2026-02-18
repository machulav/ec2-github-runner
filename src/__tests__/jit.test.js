const core = require('@actions/core');
const github = require('@actions/github');

// Mock @actions/core
jest.mock('@actions/core', () => ({
  getInput: jest.fn(),
  setOutput: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  setFailed: jest.fn(),
}));

// Mock @actions/github
jest.mock('@actions/github', () => ({
  context: {
    repo: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
  getOctokit: jest.fn(),
}));

// Mock AWS SDK
jest.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  RunInstancesCommand: jest.fn(),
  TerminateInstancesCommand: jest.fn(),
  waitUntilInstanceRunning: jest.fn(),
}));

// Default input values used across tests
const defaultInputs = {
  'mode': 'start',
  'github-token': 'test-token',
  'ec2-image-id': 'ami-123',
  'ec2-instance-type': 't3.micro',
  'subnet-id': 'subnet-123',
  'security-group-id': 'sg-123',
  'label': '',
  'ec2-instance-id': '',
  'iam-role-name': '',
  'market-type': '',
  'pre-runner-script': '',
  'runner-home-dir': '',
  'startup-quiet-period-seconds': '',
  'startup-retry-interval-seconds': '',
  'startup-timeout-minutes': '5',
  'run-runner-as-service': 'false',
  'run-runner-as-user': '',
  'ec2-volume-size': '',
  'ec2-device-name': '/dev/sda1',
  'ec2-volume-type': '',
  'block-device-mappings': '[]',
  'availability-zones-config': '',
  'metadata-options': '{}',
  'packages': '[]',
  'aws-resource-tags': '[]',
  'use-jit': 'false',
  'runner-group-id': '1',
  'runner-debug': 'false',
};

function setupInputs(overrides = {}) {
  const inputs = { ...defaultInputs, ...overrides };
  core.getInput.mockImplementation((name) => inputs[name] || '');
}

function createConfig() {
  const { Config } = require('../config');
  return new Config();
}

// Load a fresh aws module with custom inputs using jest.isolateModules
function loadFreshAws(inputOverrides = {}) {
  setupInputs(inputOverrides);
  process.env.AWS_REGION = 'us-east-1';

  let aws;
  jest.isolateModules(() => {
    aws = require('../aws');
  });
  return aws;
}

describe('Config - JIT inputs', () => {
  beforeEach(() => {
    process.env.AWS_REGION = 'us-east-1';
  });

  test('reads useJit as false by default', () => {
    setupInputs();
    const config = createConfig();
    expect(config.input.useJit).toBe(false);
  });

  test('reads useJit as true when set', () => {
    setupInputs({ 'use-jit': 'true' });
    const config = createConfig();
    expect(config.input.useJit).toBe(true);
  });

  test('reads runnerGroupId with default value of 1', () => {
    setupInputs();
    const config = createConfig();
    expect(config.input.runnerGroupId).toBe(1);
  });

  test('reads custom runnerGroupId', () => {
    setupInputs({ 'runner-group-id': '42' });
    const config = createConfig();
    expect(config.input.runnerGroupId).toBe(42);
  });

  test('throws when useJit and runAsService are both true', () => {
    setupInputs({ 'use-jit': 'true', 'run-runner-as-service': 'true' });
    expect(() => createConfig()).toThrow(
      "The 'use-jit' and 'run-runner-as-service' inputs are incompatible"
    );
  });

  test('allows useJit without runAsService', () => {
    setupInputs({ 'use-jit': 'true', 'run-runner-as-service': 'false' });
    expect(() => createConfig()).not.toThrow();
  });
});

describe('gh.js - getJitRunnerConfig', () => {
  test('calls generate-jitconfig API and returns config', async () => {
    setupInputs({ 'use-jit': 'true' });
    process.env.AWS_REGION = 'us-east-1';

    const mockRequest = jest.fn().mockResolvedValue({
      data: {
        runner: { id: 123, name: 'ec2-abc12' },
        encoded_jit_config: 'base64encodedconfig',
      },
    });
    github.getOctokit.mockReturnValue({ request: mockRequest });

    let gh;
    jest.isolateModules(() => {
      gh = require('../gh');
    });

    const result = await gh.getJitRunnerConfig('abc12');

    expect(mockRequest).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig',
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        name: 'ec2-abc12',
        runner_group_id: 1,
        labels: ['abc12'],
        work_folder: '_work',
      })
    );
    expect(result).toEqual({
      runnerId: 123,
      encodedJitConfig: 'base64encodedconfig',
    });
  });

  test('throws on API error', async () => {
    setupInputs({ 'use-jit': 'true' });
    process.env.AWS_REGION = 'us-east-1';

    const mockRequest = jest.fn().mockRejectedValue(new Error('API error'));
    github.getOctokit.mockReturnValue({ request: mockRequest });

    let gh;
    jest.isolateModules(() => {
      gh = require('../gh');
    });

    await expect(gh.getJitRunnerConfig('abc12')).rejects.toThrow('API error');
    expect(core.error).toHaveBeenCalledWith('GitHub JIT runner configuration generation error');
  });
});

describe('aws.js - user-data generation', () => {
  test('JIT user-data does not contain config.sh', () => {
    const aws = loadFreshAws({ 'use-jit': 'true' });
    const userData = aws._buildUserDataScriptForTest(null, 'testlabel', 'encodedconfig123');
    expect(userData).not.toContain('config.sh');
    expect(userData).toContain('--jitconfig encodedconfig123');
  });

  test('JIT user-data with runnerHomeDir skips download', () => {
    const aws = loadFreshAws({ 'use-jit': 'true', 'runner-home-dir': '/home/runner/actions-runner' });
    const userData = aws._buildUserDataScriptForTest(null, 'testlabel', 'encodedconfig123');
    expect(userData).toContain('/home/runner/actions-runner');
    expect(userData).not.toContain('mkdir actions-runner');
    expect(userData).not.toContain('config.sh');
    expect(userData).toContain('--jitconfig encodedconfig123');
  });

  test('JIT user-data with runAsUser uses runuser', () => {
    const aws = loadFreshAws({ 'use-jit': 'true', 'run-runner-as-user': 'ubuntu' });
    const userData = aws._buildUserDataScriptForTest(null, 'testlabel', 'encodedconfig123');
    expect(userData).toContain('runuser -u ubuntu -- ./run.sh --jitconfig encodedconfig123');
  });

  test('standard (non-JIT) user-data contains config.sh', () => {
    const aws = loadFreshAws();
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('config.sh');
    expect(userData).toContain('--token regtoken123');
    expect(userData).not.toContain('--jitconfig');
  });

  test('standard user-data with runAsService includes svc.sh', () => {
    const aws = loadFreshAws({ 'run-runner-as-service': 'true' });
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('svc.sh install');
    expect(userData).toContain('svc.sh start');
  });

  test('JIT user-data does not include svc.sh', () => {
    const aws = loadFreshAws({ 'use-jit': 'true' });
    const userData = aws._buildUserDataScriptForTest(null, 'testlabel', 'encodedconfig123');
    expect(userData).not.toContain('svc.sh');
  });

  test('user-data uses cloud-config format with write_files and runcmd', () => {
    const aws = loadFreshAws();
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toMatch(/^#cloud-config\n/);
    expect(userData).toContain('write_files:');
    expect(userData).toContain('runcmd:');
  });

  test('user-data writes setup script to /opt/ and runs with nohup', () => {
    const aws = loadFreshAws();
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('path: /opt/runner-setup.sh');
    expect(userData).toContain('permissions: "0755"');
    expect(userData).toContain('nohup /opt/runner-setup.sh &');
  });

  test('standard user-data removes stale runner config files', () => {
    const aws = loadFreshAws({ 'runner-home-dir': '/home/runner/actions-runner' });
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('rm -f .runner .credentials .credentials_rsaparams');
  });

  test('JIT user-data removes stale runner config files', () => {
    const aws = loadFreshAws({ 'use-jit': 'true', 'runner-home-dir': '/home/runner/actions-runner' });
    const userData = aws._buildUserDataScriptForTest(null, 'testlabel', 'encodedconfig123');
    expect(userData).toContain('rm -f .runner .credentials .credentials_rsaparams');
  });

  test('standard user-data with runAsUser uses runuser instead of su', () => {
    const aws = loadFreshAws({ 'run-runner-as-user': 'ec2-user' });
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('runuser -u ec2-user -- ./run.sh');
    expect(userData).not.toContain('su ec2-user');
  });

  test('standard user-data with runAsUser uses tolerant chown', () => {
    const aws = loadFreshAws({ 'run-runner-as-user': 'ec2-user' });
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('chown -R ec2-user . 2>&1 || true');
  });

  test('user-data installs packages when specified', () => {
    const aws = loadFreshAws({ 'packages': '["git", "docker.io"]' });
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('packages:');
    expect(userData).toContain('  - git');
    expect(userData).toContain('  - docker.io');
  });
});

describe('aws.js - runner-debug', () => {
  test('debug mode includes echo statements', () => {
    const aws = loadFreshAws({ 'runner-debug': 'true' });
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).toContain('[RUNNER]');
    expect(userData).toContain('echo "[RUNNER] Setup script started at');
  });

  test('non-debug mode excludes echo statements', () => {
    const aws = loadFreshAws({ 'runner-debug': 'false' });
    const userData = aws._buildUserDataScriptForTest('regtoken123', 'testlabel', null);
    expect(userData).not.toContain('[RUNNER] Setup script started');
  });
});

describe('Config - runner-debug input', () => {
  beforeEach(() => {
    process.env.AWS_REGION = 'us-east-1';
  });

  test('reads runnerDebug as false by default', () => {
    setupInputs();
    const config = createConfig();
    expect(config.input.runnerDebug).toBe(false);
  });

  test('reads runnerDebug as true when set', () => {
    setupInputs({ 'runner-debug': 'true' });
    const config = createConfig();
    expect(config.input.runnerDebug).toBe(true);
  });
});
