# Changelog

## [Unreleased]

### Added
- JIT (Just-In-Time) runner support via new `use-jit` input (default: `false`).
  JIT runners use GitHub's `generate-jitconfig` API, skip `config.sh`,
  and auto-deregister after completing one job.
- New `runner-group-id` input for specifying the runner group when using JIT mode (default: `1`).
- Validation: `use-jit` and `run-runner-as-service` cannot be used together (JIT is single-use).
- New `runner-debug` input (default: `false`) for verbose debug logging. When enabled,
  injects detailed echo statements into the setup script and polls EC2 serial console
  output during runner registration. Requires `ec2:GetConsoleOutput` IAM permission.
- New `availability-zones-config` input for multi-AZ failover. The action tries each
  configuration in sequence until an instance is successfully launched.
- New `metadata-options` input for configuring EC2 instance metadata (e.g. IMDSv2).
- New `packages` input for installing packages via cloud-init during boot.
- New `region` output for tracking which AWS region the instance was launched in.
- EC2 console output polling via `GetConsoleOutputCommand` for remote debugging.
- Test suite expanded to 25 tests covering JIT, debug mode, cloud-boothook,
  runuser, tolerant chown, stale config cleanup, and package installation.

### Changed
- Upgraded action runtime from `node20` to `node24` to resolve GitHub Actions deprecation warning (Node.js 20 actions deprecated June 2026).
- Updated `package.yml` workflow to build distribution with Node.js 24.
- Switched user-data format from `#cloud-config` with `runcmd` to `#cloud-boothook`.
  This fixes compatibility with Amazon Linux 2023 and other AMIs where
  `cloud_final_modules` may be empty or misconfigured.
- Replaced `su <user> -c` with `runuser -u <user> --` to avoid password prompts
  in non-interactive cloud-init contexts.
- Made `chown` tolerant of permission errors (`|| true`) to prevent `set -e`
  from killing the script when `_diag/` files are owned by root.
- Setup script now removes stale runner config files (`.runner`, `.credentials`,
  `.credentials_rsaparams`) before `config.sh` to handle AMIs created from
  previously configured runner instances.
- Setup script logs are written to `/tmp/runner-setup.log` instead of
  `/var/log/user-data.log` and `/dev/console` (which may not be accessible).
- Updated README with full documentation for all new inputs, IAM requirements
  for debug mode, and advanced usage sections (JIT, Multi-AZ, Debug).
