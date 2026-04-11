import { PartialScanError } from "./types.js";
import type { Scanner, ScanOptions, ScheduledTask } from "./types.js";
import {
  CrontabScanner,
  SystemdScanner,
  KubernetesScanner,
  EventBridgeScanner,
  GitHubActionsScanner,
} from "./scanners/index.js";

export interface OrchestratorOptions extends ScanOptions {
  verbose?: boolean;
}

export interface ScannerResult {
  scanner: string;
  tasks: ScheduledTask[];
  error?: string;
  durationMs: number;
}

/** All registered scanners */
function createAllScanners(): Scanner[] {
  return [
    new CrontabScanner(),
    new SystemdScanner(),
    new KubernetesScanner(),
    new EventBridgeScanner(),
    new GitHubActionsScanner(),
  ];
}

/**
 * Run all (or selected) scanners concurrently and collect results.
 */
export async function orchestrate(
  options: OrchestratorOptions,
  scanners?: Scanner[]
): Promise<{ tasks: ScheduledTask[]; results: ScannerResult[] }> {
  const allScanners = scanners ?? createAllScanners();

  // Filter to selected scanners if specified
  const selected = options.scanners
    ? allScanners.filter((s) =>
        options.scanners!.includes(s.name)
      )
    : allScanners;

  // Run all scanners concurrently
  const promises = selected.map(async (scanner): Promise<ScannerResult> => {
    const start = Date.now();
    try {
      const available = await scanner.isAvailable();
      if (!available) {
        return {
          scanner: scanner.name,
          tasks: [],
          durationMs: Date.now() - start,
        };
      }

      const tasks = await scanner.scan(options);
      return {
        scanner: scanner.name,
        tasks,
        durationMs: Date.now() - start,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // PartialScanError carries tasks collected before the failure
      const partialTasks =
        error instanceof PartialScanError ? error.tasks : [];
      return {
        scanner: scanner.name,
        tasks: partialTasks,
        error: message,
        durationMs: Date.now() - start,
      };
    }
  });

  const results = await Promise.allSettled(promises);

  const scannerResults: ScannerResult[] = results.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    // Rejected promise — should not happen due to try/catch, but handle it
    return {
      scanner: selected[i].name,
      tasks: [],
      error: String(result.reason),
      durationMs: 0,
    };
  });

  // Log warnings for errors to stderr
  for (const result of scannerResults) {
    if (result.error) {
      process.stderr.write(
        `Warning: Scanner '${result.scanner}' failed: ${result.error}\n`
      );
    }
    if (options.verbose) {
      const status = result.error
        ? `FAILED (${result.error})`
        : `OK (${result.tasks.length} tasks)`;
      process.stderr.write(
        `[${result.scanner}] ${status} in ${result.durationMs}ms\n`
      );
    }
  }

  // Collect all tasks, sorted by next run time (nulls last)
  const allTasks = scannerResults.flatMap((r) => r.tasks);
  allTasks.sort((a, b) => {
    if (!a.nextRun && !b.nextRun) return 0;
    if (!a.nextRun) return 1;
    if (!b.nextRun) return -1;
    return a.nextRun.getTime() - b.nextRun.getTime();
  });

  return { tasks: allTasks, results: scannerResults };
}
