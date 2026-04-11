/**
 * Schedule health checks — analyzes discovered tasks and flags problems.
 */

import type { ScheduledTask } from "./types.js";

export interface HealthWarning {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  tasks: ScheduledTask[];
}

export interface HealthReport {
  warnings: HealthWarning[];
  totalTasks: number;
  healthyTasks: number;
}

/**
 * Analyze an array of scheduled tasks and produce a health report
 * flagging potential problems.
 */
export function checkHealth(tasks: ScheduledTask[]): HealthReport {
  const warnings: HealthWarning[] = [];

  // 1. TOO_FREQUENT — tasks running more often than every minute
  for (const task of tasks) {
    if (isTooFrequent(task.schedule)) {
      warnings.push({
        level: "warning",
        code: "TOO_FREQUENT",
        message: `${task.name} (${task.source}) runs every minute — consider reducing frequency`,
        tasks: [task],
      });
    }
  }

  // 2. DUPLICATE_SCHEDULE — same cron expression from the same source
  const bySourceSchedule = new Map<string, ScheduledTask[]>();
  for (const task of tasks) {
    const key = `${task.source}|||${normalizeSchedule(task.schedule)}`;
    const group = bySourceSchedule.get(key) ?? [];
    group.push(task);
    bySourceSchedule.set(key, group);
  }
  for (const [, group] of bySourceSchedule) {
    if (group.length >= 2) {
      warnings.push({
        level: "warning",
        code: "DUPLICATE_SCHEDULE",
        message: `${group.length} tasks share schedule "${group[0].schedule}" in ${group[0].source}`,
        tasks: group,
      });
    }
  }

  // 3. OVERLAPPING_NAMES — same name from different sources
  const byName = new Map<string, ScheduledTask[]>();
  for (const task of tasks) {
    const group = byName.get(task.name) ?? [];
    group.push(task);
    byName.set(task.name, group);
  }
  for (const [name, group] of byName) {
    const sources = new Set(group.map((t) => t.source));
    if (sources.size >= 2) {
      const sourceList = [...sources].join(" and ");
      warnings.push({
        level: "info",
        code: "OVERLAPPING_NAMES",
        message: `"${name}" exists in both ${sourceList}`,
        tasks: group,
      });
    }
  }

  // 4. SUSPENDED — tasks with metadata indicating they are suspended/disabled
  for (const task of tasks) {
    if (isSuspended(task)) {
      warnings.push({
        level: "info",
        code: "SUSPENDED",
        message: `${task.name} (${task.source}) is suspended/disabled`,
        tasks: [task],
      });
    }
  }

  // 5. NO_NEXT_RUN — nextRun is undefined (excluding @reboot tasks)
  for (const task of tasks) {
    const schedule = task.schedule.trim().toLowerCase();
    if (task.nextRun === undefined && schedule !== "@reboot") {
      warnings.push({
        level: "warning",
        code: "NO_NEXT_RUN",
        message: `${task.name} (${task.source}) has no next run time`,
        tasks: [task],
      });
    }
  }

  // 6. STALE_EXPRESSION — nextRun is more than 366 days away
  const staleThreshold = 366 * 24 * 60 * 60 * 1000; // 366 days in ms
  const now = Date.now();
  for (const task of tasks) {
    if (task.nextRun && task.nextRun.getTime() - now > staleThreshold) {
      warnings.push({
        level: "warning",
        code: "STALE_EXPRESSION",
        message: `${task.name} (${task.source}) next run is more than a year away — expression may be stale`,
        tasks: [task],
      });
    }
  }

  // Compute healthy count: tasks not involved in any warning
  const unhealthyTasks = new Set<ScheduledTask>();
  for (const w of warnings) {
    for (const t of w.tasks) {
      unhealthyTasks.add(t);
    }
  }

  return {
    warnings,
    totalTasks: tasks.length,
    healthyTasks: tasks.length - unhealthyTasks.size,
  };
}

/**
 * Format a health report as human-readable text.
 */
export function formatHealthReport(report: HealthReport): string {
  const warningCount = report.warnings.filter((w) => w.level === "error" || w.level === "warning").length;
  const infoCount = report.warnings.filter((w) => w.level === "info").length;

  const parts: string[] = [];

  // Summary line
  const counts: string[] = [];
  if (warningCount > 0) counts.push(`${warningCount} warning${warningCount !== 1 ? "s" : ""}`);
  if (infoCount > 0) counts.push(`${infoCount} info`);

  const summary = counts.length > 0
    ? `Health Report: ${report.totalTasks} tasks analyzed, ${counts.join(", ")}`
    : `Health Report: ${report.totalTasks} tasks analyzed, all healthy`;
  parts.push(summary);

  // Individual warnings
  for (const w of report.warnings) {
    const prefix = w.level === "error" ? "[ERROR]" : w.level === "warning" ? "[WARN]" : "[INFO]";
    parts.push(`${prefix} ${w.code}: ${w.message}`);
  }

  return parts.join("\n");
}

// --- Internal helpers ---

/** Check if a cron expression fires every minute (or more often — which isn't possible in cron, so just every minute). */
function isTooFrequent(schedule: string): boolean {
  const s = schedule.trim().toLowerCase();
  // Named shortcuts that aren't every-minute
  if (s.startsWith("@")) return false;

  const fields = s.split(/\s+/);
  if (fields.length !== 5) return false;

  // Every minute: minute field is "*" and hour/dom/month/dow are all wildcards
  return fields[0] === "*" && fields[1] === "*" && fields[2] === "*" && fields[3] === "*" && fields[4] === "*";
}

/** Normalize a schedule string for deduplication. */
function normalizeSchedule(schedule: string): string {
  return schedule.trim().replace(/\s+/g, " ");
}

/** Check if task metadata indicates it is suspended or disabled. */
function isSuspended(task: ScheduledTask): boolean {
  if (!task.metadata) return false;
  const meta = task.metadata;

  for (const [key, value] of Object.entries(meta)) {
    const k = key.toLowerCase();
    const v = value.toLowerCase();

    if (k === "suspended" && (v === "true" || v === "yes" || v === "1")) return true;
    if (k === "enabled" && (v === "false" || v === "no" || v === "0")) return true;
    if (k === "disabled" && (v === "true" || v === "yes" || v === "1")) return true;
    if (k === "status" && (v === "suspended" || v === "disabled" || v === "inactive")) return true;
  }

  return false;
}
