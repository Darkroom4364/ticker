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
  /** Discover scheduled tasks from this source */
  scan(options: ScanOptions): Promise<ScheduledTask[]>;
  /** Check whether this scanner can run in the current environment */
  isAvailable(): Promise<boolean>;
}
