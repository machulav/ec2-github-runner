const core = require('@actions/core');
const github = require('@actions/github');

// get GitHub Registration Token for registering a self-hosted runner
async function getRegistrationToken() {
  const githubToken = core.getInput('github_token');
  const octokit = github.getOctokit(githubToken);

  // the values of github.context.repo.owner and github.context.repo.repo are taken from
  // the environment variable GITHUB_REPOSITORY specified in "owner/repo" format and
  // provided by the GitHub Action during the runtime
  const response = await octokit.request('POST /repos/{owner}/{repo}/actions/runners/registration-token', {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
  });

  return response.data.token;
}

module.exports = {
  getRegistrationToken,
};
