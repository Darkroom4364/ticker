export interface ScheduledTask {
  /** Unique identifier for the task (scanner-specific) */
  id: string;
  /** Human-readable name or description */
  name: string;
  /** Cron expression or schedule string */
  schedule: string;
  /** The command or action that runs */
  command: string;
  /** Which scanner discovered this task */
  source: string;
  /** Where the task is running (hostname, cluster, etc.) */
  location: string;
  /** Whether the task is currently enabled */
  enabled: boolean;
  /** ISO timestamp of the next expected run, if computable */
  nextRun?: string;
  /** Additional scanner-specific metadata */
  metadata?: Record<string, unknown>;
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
