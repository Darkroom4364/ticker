import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Scanner, ScanOptions, ScheduledTask } from "../types.js";
import { parseCronExpression } from "../utils/cron.js";

const execFileAsync = promisify(execFile);

const EXEC_TIMEOUT = 10_000;
const MAX_BUFFER = 10 * 1024 * 1024;

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
  "@reboot": null, // Special: no cron equivalent
};

/** Extract the command name (first word/path basename) for the task name */
function deriveTaskName(command: string): string {
  const firstWord = command.trim().split(/\s+/)[0];
  // Use basename if it looks like a path
  const basename = firstWord.split("/").pop() ?? firstWord;
  return basename;
}

/**
 * Parse a user-format crontab line (5 fields + command or @shortcut command):
 *   min hour dom mon dow command
 *   @daily command
 */
function parseUserCronLine(line: string): { schedule: string; command: string } | null {
  const trimmed = line.trim();

  // Handle @-shortcut entries
  if (trimmed.startsWith("@")) {
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return null;
    const shortcut = parts[0].toLowerCase();
    if (!(shortcut in CRON_SHORTCUTS)) return null;
    const schedule = CRON_SHORTCUTS[shortcut] ?? shortcut; // Use mapped expression, or raw shortcut for @reboot
    const command = parts.slice(1).join(" ");
    return { schedule, command };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 6) return null;

  const schedule = parts.slice(0, 5).join(" ");
  const command = parts.slice(5).join(" ");
  return { schedule, command };
}

/**
 * Parse a system-format crontab line (5 fields + user + command or @shortcut user command):
 *   min hour dom mon dow user command
 *   @daily user command
 */
function parseSystemCronLine(line: string): { schedule: string; command: string; user: string } | null {
  const trimmed = line.trim();

  // Handle @-shortcut entries
  if (trimmed.startsWith("@")) {
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) return null; // Need @shortcut + user + command
    const shortcut = parts[0].toLowerCase();
    if (!(shortcut in CRON_SHORTCUTS)) return null;
    const schedule = CRON_SHORTCUTS[shortcut] ?? shortcut;
    const user = parts[1];
    const command = parts.slice(2).join(" ");
    return { schedule, command, user };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 7) return null;

  const schedule = parts.slice(0, 5).join(" ");
  const user = parts[5];
  const command = parts.slice(6).join(" ");
  return { schedule, command, user };
}

/** Check if a line should be skipped (comment, blank, env var) */
function shouldSkipLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return true;
  if (trimmed.startsWith("#")) return true;
  if (ENV_VAR_RE.test(trimmed)) return true;
  return false;
}

/** Build a ScheduledTask from parsed cron data */
function buildTask(
  schedule: string,
  command: string,
  source: string,
  metadata?: Record<string, string>,
): ScheduledTask {
  const name = deriveTaskName(command);

  let nextRun: Date | undefined;
  let interval: string | undefined;
  try {
    const parsed = parseCronExpression(schedule);
    nextRun = parsed.nextRun;
    interval = parsed.interval;
  } catch {
    // If the schedule can't be parsed (e.g. @reboot), leave fields undefined
  }

  return {
    name,
    schedule,
    source,
    command,
    nextRun,
    interval,
    metadata,
  };
}

export class CrontabScanner implements Scanner {
  name = "crontab";

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("which", ["crontab"], { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  async scan(_options: ScanOptions): Promise<ScheduledTask[]> {
    const tasks: ScheduledTask[] = [];

    // Read user crontab
    const userTasks = await this.readUserCrontab();
    tasks.push(...userTasks);

    // Read system crontabs
    const systemTasks = await this.readSystemCrontabs();
    tasks.push(...systemTasks);

    return tasks;
  }

  private async readUserCrontab(): Promise<ScheduledTask[]> {
    const tasks: ScheduledTask[] = [];

    try {
      const { stdout } = await execFileAsync("crontab", ["-l"], {
        timeout: EXEC_TIMEOUT,
        maxBuffer: MAX_BUFFER,
      });
      const lines = stdout.split("\n");

      for (const line of lines) {
        if (shouldSkipLine(line)) continue;

        const parsed = parseUserCronLine(line);
        if (!parsed) continue;

        tasks.push(buildTask(parsed.schedule, parsed.command, "crontab", { type: "user" }));
      }
    } catch (error: unknown) {
      // "no crontab for user" or permission denied — return empty
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("no crontab for") ||
        message.includes("Permission denied") ||
        message.includes("EACCES")
      ) {
        return [];
      }
      throw error;
    }

    return tasks;
  }

  private async readSystemCrontabs(): Promise<ScheduledTask[]> {
    const tasks: ScheduledTask[] = [];

    // Read /etc/crontab
    try {
      const content = await readFile("/etc/crontab", "utf-8");
      const lines = content.split("\n");

      for (const line of lines) {
        if (shouldSkipLine(line)) continue;

        const parsed = parseSystemCronLine(line);
        if (!parsed) continue;

        tasks.push(
          buildTask(parsed.schedule, parsed.command, "crontab", {
            type: "system",
            user: parsed.user,
            file: "/etc/crontab",
          }),
        );
      }
    } catch {
      // /etc/crontab doesn't exist or can't be read — skip
    }

    // Read /etc/cron.d/*
    try {
      const files = await readdir("/etc/cron.d");

      for (const file of files) {
        // Skip hidden files and common non-crontab files
        if (file.startsWith(".")) continue;

        try {
          const filePath = join("/etc/cron.d", file);
          const content = await readFile(filePath, "utf-8");
          const lines = content.split("\n");

          for (const line of lines) {
            if (shouldSkipLine(line)) continue;

            const parsed = parseSystemCronLine(line);
            if (!parsed) continue;

            tasks.push(
              buildTask(parsed.schedule, parsed.command, "crontab", {
                type: "system",
                user: parsed.user,
                file: filePath,
              }),
            );
          }
        } catch {
          // Skip individual files that can't be read
        }
      }
    } catch {
      // /etc/cron.d doesn't exist — skip
    }

    return tasks;
  }
}
