export interface ScheduledTask {
  /** Human-readable name or description */
  name: string;
  /** Cron expression or schedule string (raw cron/timer string) */
  schedule: string;
  /** Which scanner discovered this task */
  source: string;
  /** Next scheduled run time, if computable */
  nextRun?: Date;
  /** Human-readable interval description (e.g. "Every day at 2:30 AM") */
  interval?: string;
  /** The command or action that runs */
  command?: string;
  /** Human-readable description of the task */
  description?: string;
  /** Additional scanner-specific metadata */
  metadata?: Record<string, string>;
}

export interface ScanOptions {
  /** Specific scanners to run (empty = all available) */
  scanners?: string[];
  /** Output format */
  format?: "table" | "json" | "yaml";
}

export interface Scanner {
  /** Display name of this scanner */
  name: string;
  /**
   * Discover scheduled tasks from this source.
   *
   * May throw on unexpected errors. When a scanner collects partial
   * results before encountering a failure, it should throw a
   * {@link PartialScanError} so the orchestrator can include the
   * partial tasks while still surfacing the error as a warning.
   */
  scan(options: ScanOptions): Promise<ScheduledTask[]>;
  /** Check whether this scanner can run in the current environment */
  isAvailable(): Promise<boolean>;
}

/**
 * Thrown when a scanner collects partial results before encountering an error.
 * The orchestrator extracts the partial tasks and still surfaces the warning.
 */
export class PartialScanError extends Error {
  constructor(
    message: string,
    public readonly tasks: ScheduledTask[],
  ) {
    super(message);
    this.name = "PartialScanError";
  }
}
