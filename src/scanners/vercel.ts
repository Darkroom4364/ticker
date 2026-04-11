import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scanner, ScanOptions, ScheduledTask } from "../types.js";
import { parseCronExpression } from "../utils/cron.js";

interface VercelCronEntry {
  path: string;
  schedule: string;
}

interface VercelConfig {
  crons?: VercelCronEntry[];
}

export class VercelScanner implements Scanner {
  name = "vercel";

  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
  }

  async isAvailable(): Promise<boolean> {
    try {
      await readFile(join(this.cwd, "vercel.json"), "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  async scan(_options: ScanOptions): Promise<ScheduledTask[]> {
    const tasks: ScheduledTask[] = [];

    let content: string;
    try {
      content = await readFile(join(this.cwd, "vercel.json"), "utf-8");
    } catch {
      return [];
    }

    let config: VercelConfig;
    try {
      config = JSON.parse(content) as VercelConfig;
    } catch {
      return [];
    }

    if (!Array.isArray(config.crons)) {
      return [];
    }

    for (const entry of config.crons) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof entry.path !== "string" ||
        typeof entry.schedule !== "string"
      ) {
        continue;
      }

      let nextRun: Date | undefined;
      let interval: string | undefined;
      try {
        const parsed = parseCronExpression(entry.schedule);
        nextRun = parsed.nextRun;
        interval = parsed.interval;
      } catch {
        // Unparseable cron — keep raw schedule
      }

      tasks.push({
        name: entry.path,
        schedule: entry.schedule,
        source: "vercel",
        nextRun,
        interval,
        metadata: {
          path: entry.path,
        },
      });
    }

    return tasks;
  }
}
