import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Scanner, ScanOptions, ScheduledTask } from "../types.js";
import { parseCronExpression } from "../utils/cron.js";

/** Minimal shape of a GitHub Actions workflow file */
interface WorkflowFile {
  name?: string;
  on?:
    | string
    | string[]
    | {
        schedule?: Array<{ cron: string }>;
        [key: string]: unknown;
      };
  jobs?: Record<string, { name?: string; [key: string]: unknown }>;
}

export class GitHubActionsScanner implements Scanner {
  name = "github-actions";

  private workflowsDir: string;

  constructor(cwd?: string) {
    this.workflowsDir = join(cwd ?? process.cwd(), ".github", "workflows");
  }

  async isAvailable(): Promise<boolean> {
    try {
      await readdir(this.workflowsDir);
      return true;
    } catch {
      return false;
    }
  }

  async scan(_options: ScanOptions): Promise<ScheduledTask[]> {
    const tasks: ScheduledTask[] = [];

    let files: string[];
    try {
      const entries = await readdir(this.workflowsDir);
      files = entries.filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    } catch {
      return [];
    }

    for (const file of files) {
      const filePath = join(this.workflowsDir, file);
      try {
        const content = await readFile(filePath, "utf-8");
        const workflow = parseYaml(content) as WorkflowFile | null;

        if (!workflow || typeof workflow !== "object") continue;

        const schedules = this.extractSchedules(workflow);
        if (schedules.length === 0) continue;

        const workflowName = workflow.name ?? file;
        const jobNames = workflow.jobs ? Object.keys(workflow.jobs) : [];

        for (const cronExpr of schedules) {
          let nextRun: Date | undefined;
          let interval: string | undefined;
          try {
            const parsed = parseCronExpression(cronExpr);
            nextRun = parsed.nextRun;
            interval = parsed.interval;
          } catch {
            // Unparseable cron
          }

          const metadata: Record<string, string> = {
            workflowFile: file,
          };
          if (workflow.name) metadata.workflowName = workflow.name;
          if (jobNames.length > 0) metadata.jobs = jobNames.join(", ");

          tasks.push({
            name: workflowName,
            schedule: cronExpr,
            source: "github-actions",
            nextRun,
            interval,
            metadata,
          });
        }
      } catch {
        // Invalid YAML or read error — skip file
        continue;
      }
    }

    return tasks;
  }

  private extractSchedules(workflow: WorkflowFile): string[] {
    const on = workflow.on;
    if (!on || typeof on !== "object" || Array.isArray(on)) return [];

    const schedules = on.schedule;
    if (!Array.isArray(schedules)) return [];

    return schedules
      .filter(
        (entry): entry is { cron: string } =>
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.cron === "string",
      )
      .map((entry) => entry.cron);
  }
}
