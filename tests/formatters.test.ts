import { describe, it, expect } from "vitest";
import type { ScheduledTask } from "../src/types.js";
import { formatTable } from "../src/formatters/table.js";
import { formatJson } from "../src/formatters/json.js";
import { formatYaml } from "../src/formatters/yaml.js";
import { format } from "../src/formatters/index.js";

const SAMPLE_TASKS: ScheduledTask[] = [
  {
    name: "daily-backup",
    schedule: "0 2 * * *",
    source: "crontab",
    nextRun: new Date("2025-06-16T02:00:00"),
    interval: "Every day at 2 AM",
    command: "/usr/bin/backup.sh",
    metadata: { user: "root" },
  },
  {
    name: "health-check",
    schedule: "rate(5 minutes)",
    source: "eventbridge",
    nextRun: new Date("2025-06-15T10:35:00"),
    interval: "Every 5 minutes",
    metadata: { arn: "arn:aws:events:us-east-1:123:rule/health-check" },
  },
  {
    name: "reboot-task",
    schedule: "@reboot",
    source: "crontab",
    interval: "At system reboot",
    command: "/usr/bin/startup.sh",
  },
];

describe("formatTable", () => {
  it("renders a table with correct columns", () => {
    const output = formatTable(SAMPLE_TASKS);
    const lines = output.split("\n");

    // Header
    expect(lines[0]).toContain("Source");
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("Schedule");
    expect(lines[0]).toContain("Next Run");
    expect(lines[0]).toContain("Command");

    // Separator
    expect(lines[1]).toContain("─");
    expect(lines[1]).toContain("┼");

    // Data rows
    expect(lines).toHaveLength(5); // header + separator + 3 rows
  });

  it("shows N/A for tasks without nextRun", () => {
    const output = formatTable(SAMPLE_TASKS);
    expect(output).toContain("N/A");
  });

  it("shows empty string for tasks without command", () => {
    const output = formatTable(SAMPLE_TASKS);
    const lines = output.split("\n");
    // health-check has no command
    const healthLine = lines.find((l) => l.includes("health-check"));
    expect(healthLine).toBeDefined();
  });

  it("auto-sizes columns to content width", () => {
    const output = formatTable(SAMPLE_TASKS);
    const lines = output.split("\n");
    // All data rows should have the same length as the header
    for (let i = 2; i < lines.length; i++) {
      expect(lines[i].length).toBe(lines[0].length);
    }
  });

  it("returns 'No scheduled tasks found' for empty array", () => {
    expect(formatTable([])).toBe("No scheduled tasks found");
  });
});

describe("formatJson", () => {
  it("returns valid pretty-printed JSON", () => {
    const output = formatJson(SAMPLE_TASKS);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].name).toBe("daily-backup");
  });

  it("returns empty array for no tasks", () => {
    const output = formatJson([]);
    expect(JSON.parse(output)).toEqual([]);
  });

  it("preserves all task fields", () => {
    const output = formatJson(SAMPLE_TASKS);
    const parsed = JSON.parse(output);
    expect(parsed[0].schedule).toBe("0 2 * * *");
    expect(parsed[0].source).toBe("crontab");
    expect(parsed[0].command).toBe("/usr/bin/backup.sh");
    expect(parsed[0].metadata.user).toBe("root");
  });
});

describe("formatYaml", () => {
  it("returns valid YAML", () => {
    const output = formatYaml(SAMPLE_TASKS);
    expect(output).toContain("name: daily-backup");
    expect(output).toContain("schedule: 0 2 * * *");
    expect(output).toContain("source: crontab");
  });

  it("returns empty array for no tasks", () => {
    const output = formatYaml([]);
    expect(output.trim()).toBe("[]");
  });

  it("includes metadata", () => {
    const output = formatYaml(SAMPLE_TASKS);
    expect(output).toContain("user: root");
  });
});

describe("format", () => {
  it("dispatches to table formatter", () => {
    const output = format(SAMPLE_TASKS, "table");
    expect(output).toContain("Source");
    expect(output).toContain("─");
  });

  it("dispatches to json formatter", () => {
    const output = format(SAMPLE_TASKS, "json");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(3);
  });

  it("dispatches to yaml formatter", () => {
    const output = format(SAMPLE_TASKS, "yaml");
    expect(output).toContain("name: daily-backup");
  });

  it("handles empty tasks for all formats", () => {
    expect(format([], "table")).toBe("No scheduled tasks found");
    expect(JSON.parse(format([], "json"))).toEqual([]);
    expect(format([], "yaml").trim()).toBe("[]");
  });
});
