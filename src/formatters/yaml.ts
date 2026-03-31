import jsYaml from "js-yaml";
import type { ScheduledTask } from "../types.js";

/**
 * Outputs tasks as YAML.
 */
export function formatYaml(tasks: ScheduledTask[]): string {
  return jsYaml.dump(tasks, { noRefs: true, lineWidth: -1 });
}
