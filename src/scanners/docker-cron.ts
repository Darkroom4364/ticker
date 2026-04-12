import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scanner, ScanOptions, ScheduledTask } from "../types.js";
import { parseCronExpression } from "../utils/cron.js";
import {
  deriveTaskName,
  parseCronLine,
  shouldSkipLine,
} from "../utils/crontab-parser.js";

/** Common crontab file paths to check in the project directory */
const CRONTAB_CANDIDATES = [
  "crontab",
  "crontab.txt",
  "cronjobs",
  "config/crontab",
];

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
