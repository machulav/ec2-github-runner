# Changelog

## [Unreleased]

### Added
- JIT (Just-In-Time) runner support via new `use-jit` input (default: `false`).
  JIT runners use GitHub's `generate-jitconfig` API, skip `config.sh`,
  and auto-deregister after completing one job.
- New `runner-group-id` input for specifying the runner group when using JIT mode (default: `1`).
- Validation: `use-jit` and `run-runner-as-service` cannot be used together (JIT is single-use).
- Test suite using Jest for JIT-related functionality (14 tests).
