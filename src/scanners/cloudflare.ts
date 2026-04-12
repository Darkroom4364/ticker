import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scanner, ScanOptions, ScheduledTask } from "../types.js";
import { parseCronExpression } from "../utils/cron.js";

interface WranglerJsonConfig {
  triggers?: {
    crons?: string[];
  };
}

/**
 * Extract the crons array from a wrangler.toml file using simple string
 * parsing. We only need to find `crons = ["...", "..."]` under a
 * `[triggers]` section — no full TOML parser needed.
 */
function parseCronsFromToml(content: string): string[] {
  // Find the [triggers] section
  const triggersMatch = content.match(/^\s*\[triggers\]\s*$/m);
  if (!triggersMatch || triggersMatch.index === undefined) return [];

  // Get text after [triggers] up to the next section header or end of file
  const afterTriggers = content.slice(
    triggersMatch.index + triggersMatch[0].length,
  );
  const nextSection = afterTriggers.search(/^\s*\[/m);
  const triggersBlock =
    nextSection === -1 ? afterTriggers : afterTriggers.slice(0, nextSection);

  // Find crons = [...] in the triggers block
  const cronsMatch = triggersBlock.match(/^\s*crons\s*=\s*\[([^\]]*)\]/m);
  if (!cronsMatch) return [];

  const arrayContent = cronsMatch[1];
  // Extract quoted strings from the array
  const strings: string[] = [];
  const stringRegex = /"([^"]*)"|'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = stringRegex.exec(arrayContent)) !== null) {
    strings.push(match[1] ?? match[2]);
  }

  return strings;
}

export class CloudflareScanner implements Scanner {
  name = "cloudflare";

  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
  }

  async isAvailable(): Promise<boolean> {
    for (const filename of ["wrangler.toml", "wrangler.json"]) {
      try {
        await readFile(join(this.cwd, filename), "utf-8");
        return true;
      } catch {
        // Try next file
      }
    }
    return false;
  }

  async scan(_options: ScanOptions): Promise<ScheduledTask[]> {
    // Try wrangler.toml first, then wrangler.json
    const cronExpressions =
      (await this.readFromToml()) ?? (await this.readFromJson());

    if (!cronExpressions || cronExpressions.length === 0) {
      return [];
    }

    const tasks: ScheduledTask[] = [];

    for (let i = 0; i < cronExpressions.length; i++) {
      const cronExpr = cronExpressions[i];
      if (typeof cronExpr !== "string") continue;

      let nextRun: Date | undefined;
      let interval: string | undefined;
      try {
        const parsed = parseCronExpression(cronExpr);
        nextRun = parsed.nextRun;
        interval = parsed.interval;
      } catch {
        // Unparseable cron — keep raw schedule
      }

      tasks.push({
        name: `cron-trigger-${i}`,
        schedule: cronExpr,
        source: "cloudflare",
        nextRun,
        interval,
        metadata: {
          configFile: this.detectedFile ?? "unknown",
        },
      });
    }

    return tasks;
  }

  private detectedFile: string | undefined;

  private async readFromToml(): Promise<string[] | null> {
    try {
      const content = await readFile(join(this.cwd, "wrangler.toml"), "utf-8");
      this.detectedFile = "wrangler.toml";
      const crons = parseCronsFromToml(content);
      return crons.length > 0 ? crons : null;
    } catch {
      return null;
    }
  }

  private async readFromJson(): Promise<string[] | null> {
    try {
      const content = await readFile(join(this.cwd, "wrangler.json"), "utf-8");
      this.detectedFile = "wrangler.json";
      const config = JSON.parse(content) as WranglerJsonConfig;
      if (Array.isArray(config.triggers?.crons)) {
        return config.triggers.crons;
      }
      return null;
    } catch {
      return null;
    }
  }
}
