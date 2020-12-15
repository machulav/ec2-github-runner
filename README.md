# (In Progress) "aws-github-runner" action for GitHub Actions

Create an on-demand AWS EC2 instance and register it as a self-hosted GitHub Actions runner for your GitHub repository.

The runner is automatically started when the GitHub Actions workflow starts, runs all your jobs and is removed after the work is done.

# Notes

## GitHub Secret Token

Your GitHub Secret Token should have `repo` scope assigned.
