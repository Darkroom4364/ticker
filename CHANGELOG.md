# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
