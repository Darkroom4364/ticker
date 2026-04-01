import { stringify } from "yaml";
import type { ScheduledTask } from "../types.js";

/**
 * Outputs tasks as YAML.
 */
export function formatYaml(tasks: ScheduledTask[]): string {
  return stringify(tasks, { aliasDuplicateObjects: false, lineWidth: 0 });
}
