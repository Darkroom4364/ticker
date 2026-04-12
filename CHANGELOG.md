# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-04-12

### Fixed

- Stale "ticker" references in README badge URL and CONTRIBUTING.md repo links
- Scanners using `exec()` replaced with `execFile()` to prevent shell injection
- Added timeouts and buffer limits to all subprocess calls to prevent CLI hangs
- Unexpected scanner errors now propagate instead of being silently swallowed

### Changed

- CI pipeline now runs lint and format checks
- Added test coverage reporting with Codecov
- Added automated npm publish on version tags via release workflow

## [0.1.0] - 2026-04-01

### Added

- CLI with `scan` command and concurrent scanner execution
- Crontab scanner for discovering Linux crontab jobs
- Systemd timer scanner for discovering systemd scheduled units
- Kubernetes CronJob scanner for discovering K8s scheduled workloads
- GitHub Actions workflow scanner for discovering scheduled CI/CD workflows
- AWS EventBridge rule scanner for discovering scheduled cloud events
- Table output formatter for terminal display
- JSON output formatter for machine-readable output
- YAML output formatter for structured data export
