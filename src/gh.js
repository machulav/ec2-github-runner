const core = require('@actions/core');
const github = require('@actions/github');
const _ = require('lodash');

function getContext() {
  // the values of github.context.repo.owner and github.context.repo.repo are taken from
  // the environment variable GITHUB_REPOSITORY specified in "owner/repo" format and
  // provided by the GitHub Action during the runtime
  return {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
  };
}

// get GitHub Registration Token for registering a self-hosted runner
async function getRegistrationToken() {
  const githubToken = core.getInput('github_token');
  const octokit = github.getOctokit(githubToken);

  const context = getContext();
  try {
    const response = await octokit.request('POST /repos/{owner}/{repo}/actions/runners/registration-token', context);
    core.info('GitHub Registration Token is received');
    return response.data.token;
  } catch (error) {
    core.error('GitHub Registration Token receiving error');
    throw error;
  }
}

// use the unique label to find the runner
// as we don't have the runner's id, it's not possible to get it in any other way
async function getRunner(label) {
  const githubToken = core.getInput('github_token');
  const octokit = github.getOctokit(githubToken);

  const context = getContext();

  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}/actions/runners', context);
    const foundRunners = _.filter(response.data.runners, { labels: [{ name: label }] });
    return foundRunners.length > 0 ? foundRunners[0] : null;
  } catch (error) {
    return null;
  }
}

async function removeRunner(label) {
  const runner = await getRunner(label);

  const githubToken = core.getInput('github_token');
  const octokit = github.getOctokit(githubToken);

  const context = getContext();

  try {
    await octokit.request('DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}', _.merge(context, { runner_id: runner.id }));
    core.info('GitHub self-hosted runner is removed');
    return;
  } catch (error) {
    core.error('GitHub self-hosted runner removal error');
    throw error;
  }
}

async function waitForRunnerCreated(label) {
  const timeoutMinutes = 10;
  const retryIntervalSeconds = 1;
  let waitSeconds = 0;

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      const runner = await getRunner(label);

      if (waitSeconds > timeoutMinutes * 60) {
        core.error('GitHub self-hosted runner creation error');
        reject(`Timeout of ${timeoutMinutes} minutes is exceeded`);
      }

      if (runner && runner.status === 'online') {
        core.info(`GitHub self-hosted runner ${runner.name} is created and ready to use`);
        clearInterval(interval);
        resolve();
      } else {
        waitSeconds += retryIntervalSeconds;
      }
    }, retryIntervalSeconds * 1000);
  });
}

module.exports = {
  getContext,
  getRegistrationToken,
  removeRunner,
  waitForRunnerCreated,
};
