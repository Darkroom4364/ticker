import { describe, it, expect } from "vitest";
import type { ScheduledTask } from "../src/types.js";
import { diffTasks, parseDuration, formatChanges } from "../src/watch.js";

// ── Fixtures ──────────────────────────────────────────────────────────

const taskA: ScheduledTask = {
  name: "backup-job",
  schedule: "0 3 * * *",
  source: "crontab",
};

const taskB: ScheduledTask = {
  name: "daily-report",
  schedule: "0 8 * * *",
  source: "kubernetes",
};

const taskC: ScheduledTask = {
  name: "cleanup",
  schedule: "0 0 * * 0",
  source: "systemd",
};

// ── diffTasks tests ───────────────────────────────────────────────────

describe("diffTasks", () => {
  it("returns no changes for identical scans", () => {
    const changes = diffTasks([taskA, taskB], [taskA, taskB]);
    expect(changes.added).toHaveLength(0);
    expect(changes.removed).toHaveLength(0);
    expect(changes.modified).toHaveLength(0);
  });

  it("detects added tasks", () => {
    const changes = diffTasks([taskA], [taskA, taskB]);
    expect(changes.added).toHaveLength(1);
    expect(changes.added[0].name).toBe("daily-report");
    expect(changes.removed).toHaveLength(0);
    expect(changes.modified).toHaveLength(0);
  });

  it("detects removed tasks", () => {
    const changes = diffTasks([taskA, taskB], [taskA]);
    expect(changes.added).toHaveLength(0);
    expect(changes.removed).toHaveLength(1);
    expect(changes.removed[0].name).toBe("daily-report");
    expect(changes.modified).toHaveLength(0);
  });

  it("detects modified tasks (schedule changed)", () => {
    const taskBModified: ScheduledTask = {
      ...taskB,
      schedule: "0 9 * * *",
    };
    const changes = diffTasks([taskA, taskB], [taskA, taskBModified]);
    expect(changes.added).toHaveLength(0);
    expect(changes.removed).toHaveLength(0);
    expect(changes.modified).toHaveLength(1);
    expect(changes.modified[0].before.schedule).toBe("0 8 * * *");
    expect(changes.modified[0].after.schedule).toBe("0 9 * * *");
  });

  it("detects multiple changes at once", () => {
    const taskBModified: ScheduledTask = {
      ...taskB,
      schedule: "0 9 * * *",
    };
    const newTask: ScheduledTask = {
      name: "new-job",
      schedule: "*/5 * * * *",
      source: "crontab",
    };

    const changes = diffTasks(
      [taskA, taskB, taskC],
      [taskBModified, newTask]
    );

    expect(changes.added).toHaveLength(1);
    expect(changes.added[0].name).toBe("new-job");
    expect(changes.removed).toHaveLength(2);
    expect(changes.removed.map((t) => t.name).sort()).toEqual([
      "backup-job",
      "cleanup",
    ]);
    expect(changes.modified).toHaveLength(1);
    expect(changes.modified[0].after.name).toBe("daily-report");
  });

  it("treats tasks with same name but different source as distinct", () => {
    const taskFromCrontab: ScheduledTask = {
      name: "backup",
      schedule: "0 3 * * *",
      source: "crontab",
    };
    const taskFromK8s: ScheduledTask = {
      name: "backup",
      schedule: "0 3 * * *",
      source: "kubernetes",
    };

    // Both exist in previous, only crontab one in current
    const changes = diffTasks(
      [taskFromCrontab, taskFromK8s],
      [taskFromCrontab]
    );
    expect(changes.removed).toHaveLength(1);
    expect(changes.removed[0].source).toBe("kubernetes");
    expect(changes.added).toHaveLength(0);
    expect(changes.modified).toHaveLength(0);
  });

  it("returns empty diff for two empty scans", () => {
    const changes = diffTasks([], []);
    expect(changes.added).toHaveLength(0);
    expect(changes.removed).toHaveLength(0);
    expect(changes.modified).toHaveLength(0);
  });

  it("detects all tasks as added on first non-empty scan vs empty", () => {
    const changes = diffTasks([], [taskA, taskB]);
    expect(changes.added).toHaveLength(2);
    expect(changes.removed).toHaveLength(0);
  });

  it("does not flag a task as modified when schedule is unchanged", () => {
    const taskACopy: ScheduledTask = { ...taskA, command: "changed-command" };
    const changes = diffTasks([taskA], [taskACopy]);
    expect(changes.modified).toHaveLength(0);
    expect(changes.added).toHaveLength(0);
    expect(changes.removed).toHaveLength(0);
  });
});

// ── parseDuration tests ───────────────────────────────────────────────

describe("parseDuration", () => {
  it("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30_000);
  });

  it("parses minutes", () => {
    expect(parseDuration("5m")).toBe(300_000);
  });

  it("parses hours", () => {
    expect(parseDuration("1h")).toBe(3_600_000);
  });

  it("rejects durations under 10 seconds", () => {
    expect(() => parseDuration("5s")).toThrow("at least 10 seconds");
  });

  it("accepts exactly 10 seconds", () => {
    expect(parseDuration("10s")).toBe(10_000);
  });

  it("throws on invalid input", () => {
    expect(() => parseDuration("abc")).toThrow("Invalid duration");
  });

  it("throws on missing unit", () => {
    expect(() => parseDuration("30")).toThrow("Invalid duration");
  });

  it("throws on empty string", () => {
    expect(() => parseDuration("")).toThrow("Invalid duration");
  });

  it("handles whitespace around input", () => {
    expect(parseDuration("  5m  ")).toBe(300_000);
  });
});

// ── formatChanges tests ───────────────────────────────────────────────

describe("formatChanges", () => {
  it("formats added tasks with + prefix", () => {
    const output = formatChanges({
      added: [taskA],
      removed: [],
      modified: [],
      timestamp: new Date("2026-04-11T22:00:00Z"),
    });
    expect(output).toContain("1 change detected:");
    expect(output).toContain("+ backup-job (crontab)");
    expect(output).toContain("0 3 * * *");
  });

  it("formats removed tasks with - prefix", () => {
    const output = formatChanges({
      added: [],
      removed: [taskB],
      modified: [],
      timestamp: new Date("2026-04-11T22:00:00Z"),
    });
    expect(output).toContain("- daily-report (kubernetes)");
    expect(output).toContain("removed");
  });

  it("formats modified tasks with ~ prefix and arrow", () => {
    const output = formatChanges({
      added: [],
      removed: [],
      modified: [
        {
          before: taskB,
          after: { ...taskB, schedule: "0 9 * * *" },
        },
      ],
      timestamp: new Date("2026-04-11T22:00:00Z"),
    });
    expect(output).toContain("~ daily-report (kubernetes)");
    expect(output).toContain("0 8 * * *");
    expect(output).toContain("0 9 * * *");
  });

  it("uses plural 'changes' for multiple changes", () => {
    const output = formatChanges({
      added: [taskA],
      removed: [taskC],
      modified: [],
      timestamp: new Date("2026-04-11T22:00:00Z"),
    });
    expect(output).toContain("2 changes detected:");
  });

  it("includes ISO timestamp", () => {
    const output = formatChanges({
      added: [taskA],
      removed: [],
      modified: [],
      timestamp: new Date("2026-04-11T22:00:00Z"),
    });
    expect(output).toContain("2026-04-11T22:00:00.000Z");
  });
});
