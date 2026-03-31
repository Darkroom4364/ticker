# Ticker

Discover every scheduled job across your infrastructure from a single CLI.

Ticker scans crontabs, systemd timers, Kubernetes CronJobs, AWS EventBridge rules, and GitHub Actions workflows — then presents them in a unified view.

## Installation

```bash
npx ticker scan
```

Or install globally:

```bash
npm install -g ticker
ticker scan
```

## Usage

```bash
# Scan all available sources and display as a table
ticker scan

# Output as JSON
ticker scan --format json

# Output as YAML
ticker scan --format yaml

# Scan only specific sources
ticker scan --scanners crontab,kubernetes

# Show scanner timing and error details
ticker scan --verbose
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
 Source      │ Name            │ Schedule    │ Next Run              │ Command
─────────────┼─────────────────┼─────────────┼───────────────────────┼──────────────
 crontab     │ backup          │ 0 2 * * *   │ 6/16/2025, 2:00:00 AM │ /usr/bin/backup.sh
 kubernetes  │ prod/daily-etl  │ 0 3 * * *   │ 6/16/2025, 3:00:00 AM │ myregistry/etl:v2
```

### JSON

```bash
ticker scan --format json
```

### YAML

```bash
ticker scan --format yaml
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

APACHE 2.0
