import type { ScheduledTask } from "./types.js";

export interface ExportOptions {
  tasks: ScheduledTask[];
  scanDurationMs?: number;
  scannerResults?: Array<{
    scanner: string;
    tasks: ScheduledTask[];
    durationMs: number;
    error?: string;
  }>;
}

/** Sanitize a label value: replace non-alphanumeric chars with underscore */
function sanitizeLabel(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Convert scan results into Prometheus exposition format (text-based).
 */
export function toPrometheus(options: ExportOptions): string {
  const { tasks, scannerResults } = options;
  const lines: string[] = [];

  // --- schedex_jobs_total ---
  const jobCounts = new Map<string, number>();
  for (const task of tasks) {
    const scanner = sanitizeLabel(task.source);
    jobCounts.set(scanner, (jobCounts.get(scanner) ?? 0) + 1);
  }

  lines.push("# HELP schedex_jobs_total Total number of discovered scheduled jobs");
  lines.push("# TYPE schedex_jobs_total gauge");
  if (jobCounts.size === 0 && !scannerResults) {
    // No tasks and no scanner info — emit a bare zero
    lines.push("schedex_jobs_total 0");
  } else if (jobCounts.size === 0 && scannerResults) {
    // Emit zero for each known scanner
    for (const sr of scannerResults) {
      lines.push(`schedex_jobs_total{scanner="${sanitizeLabel(sr.scanner)}"} 0`);
    }
  } else {
    // If we have scannerResults, ensure scanners with 0 tasks are represented
    if (scannerResults) {
      for (const sr of scannerResults) {
        const key = sanitizeLabel(sr.scanner);
        if (!jobCounts.has(key)) {
          jobCounts.set(key, 0);
        }
      }
    }
    for (const [scanner, count] of jobCounts) {
      lines.push(`schedex_jobs_total{scanner="${scanner}"} ${count}`);
    }
  }

  // --- schedex_next_run_seconds ---
  const tasksWithNextRun = tasks.filter((t) => t.nextRun != null);
  lines.push("");
  lines.push("# HELP schedex_next_run_seconds Seconds until the next scheduled run");
  lines.push("# TYPE schedex_next_run_seconds gauge");
  const now = Date.now();
  for (const task of tasksWithNextRun) {
    const seconds = Math.round((task.nextRun!.getTime() - now) / 1000);
    const jobLabel = sanitizeLabel(task.name);
    const scannerLabel = sanitizeLabel(task.source);
    lines.push(
      `schedex_next_run_seconds{job="${jobLabel}",scanner="${scannerLabel}"} ${seconds}`
    );
  }

  // --- Scanner-level metrics (only when scannerResults provided) ---
  if (scannerResults) {
    // schedex_scan_duration_seconds
    lines.push("");
    lines.push("# HELP schedex_scan_duration_seconds Time taken for each scanner to complete");
    lines.push("# TYPE schedex_scan_duration_seconds gauge");
    for (const sr of scannerResults) {
      const durationSec = (sr.durationMs / 1000).toFixed(3);
      lines.push(
        `schedex_scan_duration_seconds{scanner="${sanitizeLabel(sr.scanner)}"} ${parseFloat(durationSec)}`
      );
    }

    // schedex_scanner_errors_total
    const errored = scannerResults.filter((sr) => sr.error);
    if (errored.length > 0) {
      lines.push("");
      lines.push("# HELP schedex_scanner_errors_total Number of scanner errors");
      lines.push("# TYPE schedex_scanner_errors_total gauge");
      for (const sr of errored) {
        lines.push(
          `schedex_scanner_errors_total{scanner="${sanitizeLabel(sr.scanner)}"} 1`
        );
      }
    }
  }

  return lines.join("\n") + "\n";
}
