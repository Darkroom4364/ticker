import type { ScheduledTask } from "../types.js";
import { formatTable } from "./table.js";
import { formatJson } from "./json.js";
import { formatYaml } from "./yaml.js";

export { formatTable } from "./table.js";
export { formatJson } from "./json.js";
export { formatYaml } from "./yaml.js";

/**
 * Format tasks using the specified output format.
 */
export function format(
  tasks: ScheduledTask[],
  formatName: "table" | "json" | "yaml"
): string {
  switch (formatName) {
    case "table":
      return formatTable(tasks);
    case "json":
      return formatJson(tasks);
    case "yaml":
      return formatYaml(tasks);
  }
}
