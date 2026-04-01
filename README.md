# schedex

![CI](https://github.com/Darkroom4364/ticker/actions/workflows/ci.yml/badge.svg)
[![npm](https://img.shields.io/npm/v/schedex)](https://www.npmjs.com/package/schedex)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

Discover every scheduled job across your infrastructure from a single CLI.

schedex scans crontabs, systemd timers, Kubernetes CronJobs, AWS EventBridge rules, and GitHub Actions workflows — then presents them in a unified view.

> **Requires Node.js >= 20**

## Installation

```bash
npx schedex scan
```

Or install globally:

```bash
npm install -g schedex
schedex scan
```

## Usage

```bash
# Scan all available sources and display as a table
schedex scan

# Output as JSON
schedex scan --format json

# Output as YAML
schedex scan --format yaml

# Scan only specific sources
schedex scan --scanners crontab,kubernetes

# Show scanner timing and error details
schedex scan --verbose
```

## Scanners

| Scanner          | Source                          | What it discovers                     |
| ---------------- | ------------------------------- | ------------------------------------- |
| `crontab`        | Linux crontab                   | User and system cron jobs             |
| `systemd`        | systemd timers                  | `.timer` unit schedules               |
| `kubernetes`     | Kubernetes CronJobs             | Cluster-wide CronJob resources        |
| `eventbridge`    | AWS EventBridge                 | Scheduled rules (cron and rate)       |
| `github-actions` | GitHub Actions workflows        | `on.schedule` triggers in `.github/`  |

Each scanner checks availability first (e.g., is `kubectl` installed? do AWS credentials exist?). Unavailable scanners are silently skipped.

## Output Formats

### Table (default)

```
 Source      │ Name            │ Schedule    │ Next Run                  │ Command
─────────────┼─────────────────┼─────────────┼───────────────────────────┼──────────────
 crontab     │ backup          │ 0 2 * * *   │ 2025-06-16T02:00:00.000Z  │ /usr/bin/backup.sh
 kubernetes  │ prod/daily-etl  │ 0 3 * * *   │ 2025-06-16T03:00:00.000Z  │ myregistry/etl:v2
```

### JSON

```bash
schedex scan --format json
```

```json
[
  {
    "name": "backup",
    "schedule": "0 2 * * *",
    "source": "crontab",
    "nextRun": "2025-06-16T02:00:00.000Z",
    "interval": "Every day at 2:00 AM",
    "command": "/usr/bin/backup.sh"
  },
  {
    "name": "prod/daily-etl",
    "schedule": "0 3 * * *",
    "source": "kubernetes",
    "nextRun": "2025-06-16T03:00:00.000Z",
    "interval": "Every day at 3:00 AM",
    "command": "myregistry/etl:v2"
  }
]
```

### YAML

```bash
schedex scan --format yaml
```

```yaml
- name: backup
  schedule: 0 2 * * *
  source: crontab
  nextRun: 2025-06-16T02:00:00.000Z
  interval: Every day at 2:00 AM
  command: /usr/bin/backup.sh
- name: prod/daily-etl
  schedule: 0 3 * * *
  source: kubernetes
  nextRun: 2025-06-16T03:00:00.000Z
  interval: Every day at 3:00 AM
  command: myregistry/etl:v2
```

## Options

| Flag                       | Description                                         | Default |
| -------------------------- | --------------------------------------------------- | ------- |
| `-f, --format <format>`    | Output format: `table`, `json`, `yaml`              | `table` |
| `-s, --scanners <list>`    | Comma-separated scanner names to run                | all     |
| `-v, --verbose`            | Show scanner timing and error details               | off     |

## Exit Codes

- **0** — at least one scanner succeeded
- **1** — all scanners failed

## License

Apache 2.0
