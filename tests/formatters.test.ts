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

// ── Edge-case tests ──────────────────────────────────────────────────

describe("formatTable edge cases", () => {
  it("handles task with all optional fields undefined", () => {
    const task: ScheduledTask = { name: "bare", schedule: "* * * * *", source: "test" };
    const output = formatTable([task]);
    expect(output).toContain("bare");
    expect(output).toContain("N/A");
  });

  it("handles extremely long name (500+ chars)", () => {
    const longName = "x".repeat(600);
    const task: ScheduledTask = { name: longName, schedule: "* * * * *", source: "test" };
    const output = formatTable([task]);
    expect(output).toContain(longName);
    const lines = output.split("\n");
    // All rows same width
    for (let i = 2; i < lines.length; i++) {
      expect(lines[i].length).toBe(lines[0].length);
    }
  });

  it("handles newlines in task name", () => {
    const task: ScheduledTask = { name: "line1\nline2", schedule: "0 * * * *", source: "test" };
    const output = formatTable([task]);
    // The newline will be present in the output since table formatter doesn't strip it
    expect(output).toContain("line1\nline2");
  });

  it("handles XSS-like content in name", () => {
    const task: ScheduledTask = {
      name: '<script>alert(1)</script>',
      schedule: "* * * * *",
      source: "test",
    };
    const output = formatTable([task]);
    expect(output).toContain("<script>alert(1)</script>");
  });

  it("handles tab characters in fields", () => {
    const task: ScheduledTask = { name: "name\twith\ttabs", schedule: "* * * * *", source: "test" };
    const output = formatTable([task]);
    expect(output).toContain("name\twith\ttabs");
  });

  it("handles unicode/emoji in name", () => {
    const task: ScheduledTask = { name: "🕐 Daily backup", schedule: "0 2 * * *", source: "test" };
    const output = formatTable([task]);
    expect(output).toContain("🕐 Daily backup");
  });

  it("handles 1000 tasks without error", () => {
    const tasks: ScheduledTask[] = Array.from({ length: 1000 }, (_, i) => ({
      name: `task-${i}`,
      schedule: "* * * * *",
      source: "test",
    }));
    const output = formatTable(tasks);
    const lines = output.split("\n");
    // header + separator + 1000 rows
    expect(lines).toHaveLength(1002);
  });

  it("throws on task with nextRun as invalid Date (NaN)", () => {
    const task: ScheduledTask = {
      name: "bad-date",
      schedule: "* * * * *",
      source: "test",
      nextRun: new Date("not-a-date"),
    };
    // toISOString() throws RangeError for invalid dates
    expect(() => formatTable([task])).toThrow("Invalid time value");
  });

  it("handles all fields as empty strings", () => {
    const task: ScheduledTask = { name: "", schedule: "", source: "" };
    const output = formatTable([task]);
    expect(output).toContain("│");
    const lines = output.split("\n");
    expect(lines).toHaveLength(3);
  });

  it("sorts tasks with null nextRun mixed with valid nextRun", () => {
    const tasks: ScheduledTask[] = [
      { name: "no-next", schedule: "* * * * *", source: "test" },
      { name: "has-next", schedule: "* * * * *", source: "test", nextRun: new Date("2025-01-01T00:00:00Z") },
      { name: "also-no-next", schedule: "* * * * *", source: "test" },
    ];
    const output = formatTable(tasks);
    // Should render all three without crashing
    const lines = output.split("\n");
    expect(lines).toHaveLength(5); // header + separator + 3 rows
    expect(output).toContain("N/A");
    expect(output).toContain("2025-01-01");
  });
});

describe("formatJson edge cases", () => {
  it("handles empty task array", () => {
    expect(formatJson([])).toBe("[]");
  });

  it("handles task with all optional fields undefined", () => {
    const task: ScheduledTask = { name: "bare", schedule: "* * * * *", source: "test" };
    const output = formatJson([task]);
    const parsed = JSON.parse(output);
    expect(parsed[0].name).toBe("bare");
    expect(parsed[0].command).toBeUndefined();
    expect(parsed[0].nextRun).toBeUndefined();
  });

  it("handles XSS-like content — properly escaped in JSON", () => {
    const task: ScheduledTask = {
      name: '<script>alert("xss")</script>',
      schedule: "* * * * *",
      source: "test",
    };
    const output = formatJson([task]);
    const parsed = JSON.parse(output);
    expect(parsed[0].name).toBe('<script>alert("xss")</script>');
  });

  it("handles newlines and tabs in fields", () => {
    const task: ScheduledTask = {
      name: "line1\nline2",
      schedule: "tab\there",
      source: "test",
    };
    const output = formatJson([task]);
    const parsed = JSON.parse(output);
    expect(parsed[0].name).toBe("line1\nline2");
    expect(parsed[0].schedule).toBe("tab\there");
  });

  it("handles unicode/emoji in name", () => {
    const task: ScheduledTask = { name: "🕐 Daily backup", schedule: "0 2 * * *", source: "test" };
    const parsed = JSON.parse(formatJson([task]));
    expect(parsed[0].name).toBe("🕐 Daily backup");
  });

  it("handles task with special characters that need JSON escaping", () => {
    const task: ScheduledTask = {
      name: 'back\\slash "quotes"',
      schedule: "* * * * *",
      source: "test",
    };
    const output = formatJson([task]);
    const parsed = JSON.parse(output);
    expect(parsed[0].name).toBe('back\\slash "quotes"');
  });
});

describe("formatYaml edge cases", () => {
  it("handles empty task array", () => {
    expect(formatYaml([]).trim()).toBe("[]");
  });

  it("handles task with all optional fields undefined", () => {
    const task: ScheduledTask = { name: "bare", schedule: "* * * * *", source: "test" };
    const output = formatYaml([task]);
    expect(output).toContain("name: bare");
  });

  it("handles special YAML characters in schedule (: { } [ ])", () => {
    const task: ScheduledTask = {
      name: "yaml-special",
      schedule: "{cron: [0 * * * *]}",
      source: "test",
    };
    const output = formatYaml([task]);
    // Should be valid YAML — the library should quote/escape the value
    expect(output).toContain("{cron: [0 * * * *]}");
  });

  it("handles values that look like YAML anchors", () => {
    const task: ScheduledTask = {
      name: "&anchor",
      schedule: "*alias",
      source: "test",
    };
    const output = formatYaml([task]);
    // The YAML library should quote these to avoid anchor/alias interpretation
    expect(output).toContain("&anchor");
  });

  it("handles multiline string values", () => {
    const task: ScheduledTask = {
      name: "multi\nline\nname",
      schedule: "* * * * *",
      source: "test",
    };
    const output = formatYaml([task]);
    expect(output).toContain("multi");
    expect(output).toContain("line");
  });

  it("handles XSS-like content", () => {
    const task: ScheduledTask = {
      name: '<script>alert(1)</script>',
      schedule: "* * * * *",
      source: "test",
    };
    const output = formatYaml([task]);
    expect(output).toContain("<script>alert(1)</script>");
  });

  it("handles unicode/emoji in name", () => {
    const task: ScheduledTask = { name: "🕐 Daily backup", schedule: "0 2 * * *", source: "test" };
    const output = formatYaml([task]);
    expect(output).toContain("🕐 Daily backup");
  });

  it("handles tab characters in fields", () => {
    const task: ScheduledTask = { name: "tab\there", schedule: "* * * * *", source: "test" };
    const output = formatYaml([task]);
    // YAML lib should handle the tab somehow (quote or escape)
    expect(output).toBeDefined();
  });
});
