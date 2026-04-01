import {
  EventBridgeClient,
  ListRulesCommand,
  type Rule,
} from "@aws-sdk/client-eventbridge";
import { PartialScanError } from "../types.js";
import type { Scanner, ScanOptions, ScheduledTask } from "../types.js";
import { parseCronExpression } from "../utils/cron.js";

/**
 * Converts an AWS 6-field cron expression to a standard 5-field expression.
 * AWS format: cron(minute hour day-of-month month day-of-week year)
 * Standard:   minute hour day-of-month month day-of-week
 */
function awsCronToStandard(awsCron: string): string {
  const fields = awsCron.trim().split(/\s+/);
  if (fields.length !== 6) {
    throw new Error(`Expected 6-field AWS cron, got ${fields.length} fields`);
  }
  // Drop the year field (last), replace '?' with '*'
  return fields
    .slice(0, 5)
    .map((f) => (f === "?" ? "*" : f))
    .join(" ");
}

/**
 * Parses an AWS rate expression like "rate(5 minutes)" into a human-readable
 * interval string and computes the next run time from now.
 */
function parseRateExpression(
  rateExpr: string,
  now: Date
): { interval: string; nextRun: Date } {
  const match = rateExpr.match(/^rate\((\d+)\s+(minutes?|hours?|days?)\)$/i);
  if (!match) {
    throw new Error(`Invalid rate expression: ${rateExpr}`);
  }

  const value = parseInt(match[1], 10);
  const rawUnit = match[2].toLowerCase();
  const unit = rawUnit.endsWith("s") ? rawUnit : rawUnit + "s";

  let intervalMs: number;
  let intervalLabel: string;
  switch (unit) {
    case "minutes":
      intervalMs = value * 60 * 1000;
      intervalLabel = value === 1 ? "Every minute" : `Every ${value} minutes`;
      break;
    case "hours":
      intervalMs = value * 60 * 60 * 1000;
      intervalLabel = value === 1 ? "Every hour" : `Every ${value} hours`;
      break;
    case "days":
      intervalMs = value * 24 * 60 * 60 * 1000;
      intervalLabel = value === 1 ? "Every day" : `Every ${value} days`;
      break;
    default:
      throw new Error(`Unknown rate unit: ${unit}`);
  }

  const nextRun = new Date(now.getTime() + intervalMs);
  return { interval: intervalLabel, nextRun };
}

export class EventBridgeScanner implements Scanner {
  name = "eventbridge";

  private client: EventBridgeClient;

  constructor(client?: EventBridgeClient) {
    this.client = client ?? new EventBridgeClient({});
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.send(new ListRulesCommand({ Limit: 1 }));
      return true;
    } catch {
      return false;
    }
  }

  async scan(_options: ScanOptions): Promise<ScheduledTask[]> {
    const tasks: ScheduledTask[] = [];

    let nextToken: string | undefined;
    try {
      do {
        const response = await this.client.send(
          new ListRulesCommand({ NextToken: nextToken })
        );

        for (const rule of response.Rules ?? []) {
          const task = this.ruleToTask(rule);
          if (task) {
            tasks.push(task);
          }
        }

        nextToken = response.NextToken;
      } while (nextToken);
    } catch (error: unknown) {
      if (tasks.length > 0) {
        // Partial results collected before failure — attach them to the
        // error so the orchestrator can both surface the warning AND
        // return the tasks that were successfully fetched.
        const partialError = new PartialScanError(
          error instanceof Error ? error.message : String(error),
          tasks,
        );
        throw partialError;
      }
      // Total failure (no tasks collected) — rethrow as-is
      throw error;
    }

    return tasks;
  }

  private ruleToTask(rule: Rule): ScheduledTask | undefined {
    const scheduleExpr = rule.ScheduleExpression;
    if (!scheduleExpr) return undefined;

    const now = new Date();
    let nextRun: Date | undefined;
    let interval: string | undefined;

    if (scheduleExpr.startsWith("cron(") && scheduleExpr.endsWith(")")) {
      const awsCronBody = scheduleExpr.slice(5, -1);
      try {
        const standardCron = awsCronToStandard(awsCronBody);
        const parsed = parseCronExpression(standardCron, now);
        nextRun = parsed.nextRun;
        interval = parsed.interval;
      } catch {
        // Unparseable cron — keep raw schedule
      }
    } else if (scheduleExpr.startsWith("rate(")) {
      try {
        const parsed = parseRateExpression(scheduleExpr, now);
        nextRun = parsed.nextRun;
        interval = parsed.interval;
      } catch {
        // Unparseable rate — keep raw schedule
      }
    }

    const metadata: Record<string, string> = {};
    if (rule.Arn) metadata.arn = rule.Arn;
    if (rule.EventBusName) metadata.eventBus = rule.EventBusName;
    if (rule.State) metadata.state = rule.State;

    return {
      name: rule.Name ?? "unnamed-rule",
      schedule: scheduleExpr,
      source: "eventbridge",
      nextRun,
      interval,
      metadata,
    };
  }
}
