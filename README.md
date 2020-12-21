# On-demand self-hosted EC2 runner for GitHub Actions

Using this GitHub action, you can start a new EC2 instance and register it as a [self-hosted runner in GitHub](<(https://docs.github.com/en/free-pro-team@latest/actions/hosting-your-own-runners)>) right before you need it. Then run all the required jobs on it and stop it when you don't need it anymore.

**Table of Contents**

- [Usage](#usage)
  - [Inputs](#inputs)
  - [Environment variables](#environment-variables)
  - [Outputs](#outputs)
  - [Example](#example)
- [License Summary](#license-summary)

## Usage

### Inputs

| Name                | Required                              | Description                                                                                                                                                                                                     |
| ------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`              | Always.                               | Specify here which mode you want to use:<br>- `start` - to start a new runner;<br>- `stop` - to stop the previously created runner.                                                                             |
| `github-token`      | Always.                               | GitHub Personal Access Token with a `repo` scope assigned.                                                                                                                                                      |
| `ec2-image-id`      | Required if you use the `start` mode. | EC2 AMI Id. <br><br> The new runner will be launched from this image.                                                                                                                                           |
| `ec2-instance-type` | Required if you use the `start` mode. | EC2 Instance Type.                                                                                                                                                                                              |
| `subnet-id`         | Required if you use the `start` mode. | VPC Subnet Id. The subnet should belong to the same VPC as the specified security group.                                                                                                                        |
| `security-group-id` | Required if you use the `start` mode. | EC2 Security Group Id. <br><br> The security group should belong to the same VPC as the specified subnet. <br><br> The runner doesn't require any inbound traffic. However, outbound traffic should be allowed. |
| `label`             | Required if you use the `stop` mode.  | Name of the unique label assigned to the runner. <br><br> The label is used to remove the runner from GitHub when the runner is not needed anymore.                                                             |
| `ec2-instance-id`   | Required if you use the `stop` mode.  | EC2 Instance Id of the created runner. <br><br> The id is used to terminate the EC2 instance when the runner is not needed anymore.                                                                             |

### Environment variables

In addition to the inputs described above, the action also requires the following environment variables to access your AWS account:

- `AWS_DEFAULT_REGION`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

We recommend using [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials) action right before running the step for creating a self-hosted runner. This action perfectly does the job of setting the required environment variables.

### Outputs

| Name              | Description                                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`           | Name of the unique label assigned to the runner. <br><br> The label is used in two cases: <br> - to use as the input of `runs-on` property for the following jobs; <br> - to remove the runner from GitHub when it is not needed anymore. |
| `ec2-instance-id` | EC2 Instance Id of the created runner. <br><br> The id is used to terminate the EC2 instance when the runner is not needed anymore.                                                                                                       |

### Example

In the following example, you can see how to start your EC2 self-hosted runner right before the job should be done, run the job on it, and then stop it at the end when you finish:

![GitHub Actions self-hosted EC2 runner](docs/images/github-actions-summary.png)

The workflow, declared in `.github/workflows/do-the-job.yml`, looks like this:

```yml
name: do-the-job
on: pull_request
jobs:
  start-runner:
    name: Start self-hosted EC2 runner
    runs-on: ubuntu-latest
    outputs:
      label: ${{ steps.start-ec2-runner.outputs.label }}
      ec2-instance-id: ${{ steps.start-ec2-runner.outputs.ec2-instance-id }}
    steps:
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v1
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}
      - name: Start EC2 runner
        id: start-ec2-runner
        uses: machulav/ec2-github-runner@main
        with:
          mode: start
          github-token: ${{ secrets.GH_PERSONAL_ACCESS_TOKEN }}
          ec2-image-id: ami-123
          ec2-instance-type: t3.nano
          subnet-id: subnet-123
          security-group-id: sg-123
  do-the-job:
    name: Do the job
    runs-on: ${{ needs.start-runner.outputs.label }} # run the job on the newly created runner
    needs: start-runner # required to start the main job when the runner is ready
    steps:
      - name: Hello World
        run: echo 'Hello World!'
  stop-runner:
    name: Stop self-hosted EC2 runner
    runs-on: ubuntu-latest
    needs:
      - start-runner # required to get output from the job in this job
      - do-the-job # required to remove the runner when the main job is done
    steps:
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v1
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}
      - name: Stop EC2 runner
        uses: machulav/aws-github-runner@main
        with:
          mode: stop
          github-token: ${{ secrets.GH_PERSONAL_ACCESS_TOKEN }}
          label: ${{ needs.start-runner.outputs.label }}
          ec2-instance-id: ${{ needs.start-runner.outputs.ec2-instance-id }}
```

## License Summary

This code is made available under the MIT license.
