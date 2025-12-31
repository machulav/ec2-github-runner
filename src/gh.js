const core = require('@actions/core');
const github = require('@actions/github');
const _ = require('lodash');
const config = require('./config');

// use the unique label to find the runner
// as we don't have the runner's id, it's not possible to get it in any other way
async function getRunner(label) {
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const runners = await octokit.paginate('GET /repos/{owner}/{repo}/actions/runners', config.githubContext);
    const foundRunners = _.filter(runners, { labels: [{ name: label }] });
    return foundRunners.length > 0 ? foundRunners[0] : null;
  } catch (error) {
    return null;
  }
}

// get GitHub Registration Token for registering a self-hosted runner
async function getRegistrationToken() {
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const response = await octokit.request('POST /repos/{owner}/{repo}/actions/runners/registration-token', config.githubContext);
    core.info('GitHub Registration Token is received');
    return response.data.token;
  } catch (error) {
    core.error('GitHub Registration Token receiving error');
    throw error;
  }
}

function isRetryableError(error) {
  if (!error.status) return false;
  
  // Retry on server errors and rate limits
  return error.status >= 500 || error.status === 429;
}

async function removeRunner() {
  const runner = await getRunner(config.input.label);
  const octokit = github.getOctokit(config.input.githubToken);

  // skip the runner removal process if the runner is not found
  if (!runner) {
    core.info(`GitHub self-hosted runner with label ${config.input.label} is not found, so the removal is skipped`);
    return;
  }

  const maxRetries = 3;
  const baseDelayMs = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await octokit.request('DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}', _.merge(config.githubContext, { runner_id: runner.id }));
      core.info(`GitHub self-hosted runner ${runner.name} is removed`);
      return;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      
      // If runner not found, consider it success (already removed)
      if (error.status === 404) {
        core.info(`GitHub self-hosted runner ${runner.name} was already removed`);
        return;
      }

      if (!isRetryableError(error) || isLastAttempt) {
        core.error(`GitHub self-hosted runner removal error after ${attempt} attempts (HTTP ${error.status}): ${error.message || error}`);
        throw error;
      }

      // Exponential backoff with jitter
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000;
      core.info(`GitHub runner removal attempt ${attempt} failed (${error.status}), retrying in ${Math.round(delayMs)}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

async function waitForRunnerRegistered(label) {
  const timeoutMinutes = parseInt(config.input.startupTimeoutMinutes) || 5;
  const retryIntervalSeconds = parseInt(config.input.startupRetryIntervalSeconds) || 10;
  const quietPeriodSeconds = parseInt(config.input.startupQuietPeriodSeconds) || 30;

  core.info(`Waiting ${quietPeriodSeconds}s for the AWS EC2 instance to be registered in GitHub as a new self-hosted runner`);
  await new Promise((r) => setTimeout(r, quietPeriodSeconds * 1000));
  core.info(`Checking every ${retryIntervalSeconds}s if the GitHub self-hosted runner is registered`);
  core.info(`The maximum waiting time is ${timeoutMinutes} minutes`);

  const startTime = Date.now();
  const timeoutMs = timeoutMinutes * 60 * 1000;

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      const elapsedMs = Date.now() - startTime;
      const runner = await getRunner(label);

      if (runner && runner.status === 'online') {
        core.info(`GitHub self-hosted runner ${runner.name} is registered and ready to use`);
        clearInterval(interval);
        resolve();
      } else if (elapsedMs >= timeoutMs) {
        core.error('GitHub self-hosted runner registration error');
        clearInterval(interval);
        reject(
          `A timeout of ${timeoutMinutes} minutes is exceeded. Your AWS EC2 instance was not able to register itself in GitHub as a new self-hosted runner.`,
        );
      } else {
        core.info('Checking...');
      }
    }, retryIntervalSeconds * 1000);
  });
}

module.exports = {
  getRegistrationToken,
  removeRunner,
  waitForRunnerRegistered,
};
