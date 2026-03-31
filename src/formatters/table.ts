import type { ScheduledTask } from "../types.js";

interface Column {
  header: string;
  getValue: (task: ScheduledTask) => string;
}

const COLUMNS: Column[] = [
  { header: "Source", getValue: (t) => t.source },
  { header: "Name", getValue: (t) => t.name },
  { header: "Schedule", getValue: (t) => t.schedule },
  {
    header: "Next Run",
    getValue: (t) =>
      t.nextRun ? t.nextRun.toLocaleString() : "N/A",
  },
  { header: "Command", getValue: (t) => t.command ?? "" },
];

/**
 * Renders tasks as an ASCII table with auto-sized columns.
 */
export function formatTable(tasks: ScheduledTask[]): string {
  if (tasks.length === 0) {
    return "No scheduled tasks found";
  }

  // Compute column widths
  const widths = COLUMNS.map((col) =>
    Math.max(
      col.header.length,
      ...tasks.map((task) => col.getValue(task).length)
    )
  );

  const separator = widths.map((w) => "─".repeat(w + 2)).join("┼");
  const headerLine = COLUMNS.map(
    (col, i) => ` ${col.header.padEnd(widths[i])} `
  ).join("│");

  const rows = tasks.map((task) =>
    COLUMNS.map(
      (col, i) => ` ${col.getValue(task).padEnd(widths[i])} `
    ).join("│")
  );

  return [headerLine, separator, ...rows].join("\n");
}
