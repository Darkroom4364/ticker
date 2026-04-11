import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scanner, ScanOptions, ScheduledTask } from "../types.js";
import { parseCronExpression } from "../utils/cron.js";

/** Regex to detect environment variable lines like SHELL=/bin/bash */
const ENV_VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Map @-shortcut names to standard 5-field cron expressions */
const CRON_SHORTCUTS: Record<string, string | null> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
  "@reboot": null,
};

/** Common crontab file paths to check in the project directory */
const CRONTAB_CANDIDATES = [
  "crontab",
  "crontab.txt",
  "cronjobs",
  "config/crontab",
];

/** Extract the command name (first word/path basename) for the task name */
function deriveTaskName(command: string): string {
  const firstWord = command.trim().split(/\s+/)[0];
  const basename = firstWord.split("/").pop() ?? firstWord;
  return basename;
}

/**
 * Parse a user-format crontab line (5 fields + command or @shortcut command).
 */
function parseCronLine(line: string): { schedule: string; command: string } | null {
  const trimmed = line.trim();

  // Handle @-shortcut entries
  if (trimmed.startsWith("@")) {
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return null;
    const shortcut = parts[0].toLowerCase();
    if (!(shortcut in CRON_SHORTCUTS)) return null;
    const schedule = CRON_SHORTCUTS[shortcut] ?? shortcut;
    const command = parts.slice(1).join(" ");
    return { schedule, command };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 6) return null;

  const schedule = parts.slice(0, 5).join(" ");
  const command = parts.slice(5).join(" ");
  return { schedule, command };
}

/** Check if a line should be skipped (comment, blank, env var) */
function shouldSkipLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return true;
  if (trimmed.startsWith("#")) return true;
  if (ENV_VAR_RE.test(trimmed)) return true;
  return false;
}

export class DockerCronScanner implements Scanner {
  name = "docker-cron";

  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
  }

  async isAvailable(): Promise<boolean> {
    for (const candidate of CRONTAB_CANDIDATES) {
      try {
        await readFile(join(this.cwd, candidate), "utf-8");
        return true;
      } catch {
        // Try next candidate
      }
    }
    return false;
  }

  async scan(_options: ScanOptions): Promise<ScheduledTask[]> {
    const tasks: ScheduledTask[] = [];

    for (const candidate of CRONTAB_CANDIDATES) {
      const filePath = join(this.cwd, candidate);
      let content: string;
      try {
        content = await readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (const line of lines) {
        if (shouldSkipLine(line)) continue;

        const parsed = parseCronLine(line);
        if (!parsed) continue;

        let nextRun: Date | undefined;
        let interval: string | undefined;
        try {
          const cronResult = parseCronExpression(parsed.schedule);
          nextRun = cronResult.nextRun;
          interval = cronResult.interval;
        } catch {
          // Unparseable cron (e.g. @reboot) — leave fields undefined
        }

        tasks.push({
          name: deriveTaskName(parsed.command),
          schedule: parsed.schedule,
          source: "docker-cron",
          command: parsed.command,
          nextRun,
          interval,
          metadata: {
            file: candidate,
          },
        });
      }
    }

    return tasks;
  }
}
