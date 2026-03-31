import type { ScheduledTask } from "../types.js";

/**
 * Outputs tasks as pretty-printed JSON.
 */
export function formatJson(tasks: ScheduledTask[]): string {
  return JSON.stringify(tasks, null, 2);
}
