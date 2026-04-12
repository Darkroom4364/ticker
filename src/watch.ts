import type { ScheduledTask } from "./types.js";
import { orchestrate } from "./orchestrator.js";
import { format } from "./formatters/index.js";

export interface WatchOptions {
  intervalMs: number;
  scanners?: string[];
  format?: "table" | "json" | "yaml";
  verbose?: boolean;
  recursive?: string;
  onChanges?: (changes: WatchChanges) => void;
}

export interface WatchChanges {
  added: ScheduledTask[];
  removed: ScheduledTask[];
  modified: Array<{ before: ScheduledTask; after: ScheduledTask }>;
  timestamp: Date;
}

/**
 * Build a composite key for a task: name + source.
 */
function taskKey(task: ScheduledTask): string {
  return `${task.name}\0${task.source}`;
}

/**
 * Compute the diff between two scan results.
 * Pure function — no side effects.
 */
export function diffTasks(
  previous: ScheduledTask[],
  current: ScheduledTask[],
): WatchChanges {
  const prevMap = new Map<string, ScheduledTask>();
  for (const task of previous) {
    prevMap.set(taskKey(task), task);
  }

  const currMap = new Map<string, ScheduledTask>();
  for (const task of current) {
    currMap.set(taskKey(task), task);
  }

  const added: ScheduledTask[] = [];
  const removed: ScheduledTask[] = [];
  const modified: Array<{ before: ScheduledTask; after: ScheduledTask }> = [];

  // Find added and modified
  for (const [key, task] of currMap) {
    const prev = prevMap.get(key);
    if (!prev) {
      added.push(task);
    } else if (prev.schedule !== task.schedule) {
      modified.push({ before: prev, after: task });
    }
  }

  // Find removed
  for (const [key, task] of prevMap) {
    if (!currMap.has(key)) {
      removed.push(task);
    }
  }

  return { added, removed, modified, timestamp: new Date() };
}

/**
 * Format a WatchChanges object into a human-readable summary string.
 */
export function formatChanges(changes: WatchChanges): string {
  const totalChanges =
    changes.added.length + changes.removed.length + changes.modified.length;

  const lines: string[] = [];
  lines.push(
    `[${changes.timestamp.toISOString()}] ${totalChanges} change${totalChanges !== 1 ? "s" : ""} detected:`,
  );

  for (const task of changes.added) {
    lines.push(`  + ${task.name} (${task.source}) \u2014 ${task.schedule}`);
  }

  for (const { before, after } of changes.modified) {
    lines.push(
      `  ~ ${after.name} (${after.source}) \u2014 schedule changed: ${before.schedule} \u2192 ${after.schedule}`,
    );
  }

  for (const task of changes.removed) {
    lines.push(`  - ${task.name} (${task.source}) \u2014 removed`);
  }

  return lines.join("\n");
}

/**
 * Parse a human-friendly duration string into milliseconds.
 * Supports: "30s", "5m", "1h". Minimum 10 seconds.
 */
export function parseDuration(input: string): number {
  const match = input.trim().match(/^(\d+)\s*(s|m|h)$/i);
  if (!match) {
    throw new Error(
      `Invalid duration '${input}'. Use a number followed by s, m, or h (e.g. 30s, 5m, 1h).`,
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  let ms: number;
  switch (unit) {
    case "s":
      ms = value * 1000;
      break;
    case "m":
      ms = value * 60 * 1000;
      break;
    case "h":
      ms = value * 60 * 60 * 1000;
      break;
    default:
      throw new Error(`Unknown duration unit '${unit}'.`);
  }

  if (ms < 10_000) {
    throw new Error(`Interval must be at least 10 seconds. Got ${input}.`);
  }

  return ms;
}

/**
 * Start watching for schedule changes by polling scanners at an interval.
 * Returns a stop function that cleans up the interval and prints a summary.
 */
export function watch(options: WatchOptions): () => void {
  const formatName = options.format ?? "table";
  let previousTasks: ScheduledTask[] | null = null;
  let scanCount = 0;
  let totalChanges = 0;
  let stopped = false;
  let scanInFlight = false;

  const runScan = async () => {
    if (stopped || scanInFlight) return;
    scanInFlight = true;

    try {
      const { tasks } = await orchestrate({
        scanners: options.scanners,
        format: formatName,
        verbose: options.verbose,
        recursive: options.recursive,
      });

      scanCount++;

      if (previousTasks === null) {
        // First scan — print full results
        const output = format(tasks, formatName);
        process.stdout.write(output + "\n");
        if (options.verbose) {
          process.stderr.write(
            `[watch] Initial scan complete: ${tasks.length} task(s) found. Polling every ${options.intervalMs / 1000}s.\n`,
          );
        }
      } else {
        // Subsequent scan — diff
        const changes = diffTasks(previousTasks, tasks);
        const changeCount =
          changes.added.length +
          changes.removed.length +
          changes.modified.length;

        if (changeCount > 0) {
          totalChanges += changeCount;
          process.stdout.write(formatChanges(changes) + "\n");
          if (options.onChanges) {
            options.onChanges(changes);
          }
        } else if (options.verbose) {
          process.stderr.write(
            `[${new Date().toISOString()}] No changes detected.\n`,
          );
        }
      }

      previousTasks = tasks;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[watch] Scan error: ${message}\n`);
    } finally {
      scanInFlight = false;
    }
  };

  // Run first scan immediately
  void runScan();

  // Set up polling
  const intervalId = setInterval(() => {
    void runScan();
  }, options.intervalMs);

  // Return cleanup function
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(intervalId);
    if (options.verbose) {
      process.stderr.write(
        `\n[watch] Stopped after ${scanCount} scan(s), ${totalChanges} total change(s) detected.\n`,
      );
    }
  };

  return stop;
}
