import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScheduledTask } from "../src/types.js";
import { diffTasks, parseDuration, formatChanges, watch } from "../src/watch.js";

vi.mock("../src/orchestrator.js", () => ({
  orchestrate: vi.fn(),
}));

vi.mock("../src/formatters/index.js", () => ({
  format: vi.fn(),
}));

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

// ── watch() tests ────────────────────────────────────────────────────

describe("watch()", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  // Lazily import the mocked modules so we can control return values
  let orchestrate: ReturnType<typeof vi.fn>;
  let formatFn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();

    const orchMod = await import("../src/orchestrator.js");
    orchestrate = orchMod.orchestrate as unknown as ReturnType<typeof vi.fn>;

    const fmtMod = await import("../src/formatters/index.js");
    formatFn = fmtMod.format as unknown as ReturnType<typeof vi.fn>;

    orchestrate.mockReset();
    formatFn.mockReset();

    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("returns a stop function", () => {
    orchestrate.mockResolvedValue({ tasks: [] });
    formatFn.mockReturnValue("");

    const stop = watch({ intervalMs: 30_000 });
    expect(typeof stop).toBe("function");
    stop();
  });

  it("first scan writes formatted output to stdout", async () => {
    orchestrate.mockResolvedValue({ tasks: [taskA] });
    formatFn.mockReturnValue("FORMATTED_TABLE");

    const stop = watch({ intervalMs: 30_000 });

    // Flush the microtask queue so the initial async runScan completes
    await vi.advanceTimersByTimeAsync(0);

    expect(formatFn).toHaveBeenCalledWith([taskA], "table");
    expect(stdoutSpy).toHaveBeenCalledWith("FORMATTED_TABLE\n");

    stop();
  });

  it("stop function clears the interval — no more scans after stop", async () => {
    orchestrate.mockResolvedValue({ tasks: [] });
    formatFn.mockReturnValue("");

    const stop = watch({ intervalMs: 30_000 });

    // Let the initial scan finish
    await vi.advanceTimersByTimeAsync(0);
    expect(orchestrate).toHaveBeenCalledTimes(1);

    stop();

    // Advance well past the next interval — no additional scans should fire
    await vi.advanceTimersByTimeAsync(90_000);
    expect(orchestrate).toHaveBeenCalledTimes(1);
  });

  it("verbose mode writes initial scan info to stderr", async () => {
    orchestrate.mockResolvedValue({ tasks: [taskA, taskB] });
    formatFn.mockReturnValue("TABLE");

    const stop = watch({ intervalMs: 30_000, verbose: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Initial scan complete: 2 task(s) found"),
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Polling every 30s"),
    );

    stop();
  });

  it("onChanges callback fires when diff has changes", async () => {
    const onChanges = vi.fn();

    // First scan returns taskA, second scan returns taskA + taskB (added)
    orchestrate
      .mockResolvedValueOnce({ tasks: [taskA] })
      .mockResolvedValueOnce({ tasks: [taskA, taskB] });
    formatFn.mockReturnValue("TABLE");

    const stop = watch({ intervalMs: 30_000, onChanges });

    // Let first scan complete
    await vi.advanceTimersByTimeAsync(0);
    expect(onChanges).not.toHaveBeenCalled();

    // Advance to trigger second scan
    await vi.advanceTimersByTimeAsync(30_000);

    expect(onChanges).toHaveBeenCalledTimes(1);
    const changes = onChanges.mock.calls[0][0];
    expect(changes.added).toHaveLength(1);
    expect(changes.added[0].name).toBe("daily-report");

    stop();
  });

  it("scanInFlight prevents overlapping scans", async () => {
    // Make orchestrate return a promise that we control manually
    let resolveFirst!: (v: { tasks: ScheduledTask[] }) => void;
    orchestrate.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    formatFn.mockReturnValue("TABLE");

    const stop = watch({ intervalMs: 10_000 });

    // The initial runScan fires but hasn't resolved yet (scanInFlight = true)
    // Advance past the interval to trigger the next scheduled scan
    await vi.advanceTimersByTimeAsync(10_000);

    // orchestrate should still only have been called once because the first
    // scan is still in flight and the guard prevents a second invocation
    expect(orchestrate).toHaveBeenCalledTimes(1);

    // Now resolve the first scan
    resolveFirst({ tasks: [taskA] });
    await vi.advanceTimersByTimeAsync(0);

    // Next interval tick should now be able to scan
    orchestrate.mockResolvedValueOnce({ tasks: [taskA] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(orchestrate).toHaveBeenCalledTimes(2);

    stop();
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  it("no changes detected when scanner returns same results twice", async () => {
    orchestrate
      .mockResolvedValueOnce({ tasks: [taskA] })
      .mockResolvedValueOnce({ tasks: [taskA] });
    formatFn.mockReturnValue("TABLE");
    const onChanges = vi.fn();

    const stop = watch({ intervalMs: 30_000, onChanges });
    await vi.advanceTimersByTimeAsync(0); // initial scan
    await vi.advanceTimersByTimeAsync(30_000); // second scan

    expect(onChanges).not.toHaveBeenCalled();
    stop();
  });

  it("detects new tasks added between polls", async () => {
    orchestrate
      .mockResolvedValueOnce({ tasks: [taskA] })
      .mockResolvedValueOnce({ tasks: [taskA, taskB] });
    formatFn.mockReturnValue("TABLE");
    const onChanges = vi.fn();

    const stop = watch({ intervalMs: 30_000, onChanges });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(onChanges).toHaveBeenCalledTimes(1);
    expect(onChanges.mock.calls[0][0].added).toHaveLength(1);
    expect(onChanges.mock.calls[0][0].added[0].name).toBe("daily-report");
    stop();
  });

  it("detects removed tasks between polls", async () => {
    orchestrate
      .mockResolvedValueOnce({ tasks: [taskA, taskB] })
      .mockResolvedValueOnce({ tasks: [taskA] });
    formatFn.mockReturnValue("TABLE");
    const onChanges = vi.fn();

    const stop = watch({ intervalMs: 30_000, onChanges });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(onChanges).toHaveBeenCalledTimes(1);
    expect(onChanges.mock.calls[0][0].removed).toHaveLength(1);
    expect(onChanges.mock.calls[0][0].removed[0].name).toBe("daily-report");
    stop();
  });

  it("detects schedule change between polls", async () => {
    const taskBChanged = { ...taskB, schedule: "0 12 * * *" };
    orchestrate
      .mockResolvedValueOnce({ tasks: [taskB] })
      .mockResolvedValueOnce({ tasks: [taskBChanged] });
    formatFn.mockReturnValue("TABLE");
    const onChanges = vi.fn();

    const stop = watch({ intervalMs: 30_000, onChanges });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(onChanges).toHaveBeenCalledTimes(1);
    const changes = onChanges.mock.calls[0][0];
    expect(changes.modified).toHaveLength(1);
    expect(changes.modified[0].before.schedule).toBe("0 8 * * *");
    expect(changes.modified[0].after.schedule).toBe("0 12 * * *");
    stop();
  });

  it("handles scanner throwing on second poll", async () => {
    orchestrate
      .mockResolvedValueOnce({ tasks: [taskA] })
      .mockRejectedValueOnce(new Error("scan exploded"));
    formatFn.mockReturnValue("TABLE");

    const stop = watch({ intervalMs: 30_000 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Scan error: scan exploded"),
    );
    stop();
  });

  it("recovers after scanner error and detects changes on next poll", async () => {
    orchestrate
      .mockResolvedValueOnce({ tasks: [taskA] })
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ tasks: [taskA, taskC] });
    formatFn.mockReturnValue("TABLE");
    const onChanges = vi.fn();

    const stop = watch({ intervalMs: 10_000, onChanges });
    await vi.advanceTimersByTimeAsync(0);    // initial scan
    await vi.advanceTimersByTimeAsync(10_000); // error scan
    await vi.advanceTimersByTimeAsync(10_000); // recovery scan

    // After error, previousTasks should still be [taskA], so adding taskC is detected
    expect(onChanges).toHaveBeenCalledTimes(1);
    expect(onChanges.mock.calls[0][0].added).toHaveLength(1);
    expect(onChanges.mock.calls[0][0].added[0].name).toBe("cleanup");
    stop();
  });

  it("stop is idempotent — calling twice does not throw", async () => {
    orchestrate.mockResolvedValue({ tasks: [] });
    formatFn.mockReturnValue("");

    const stop = watch({ intervalMs: 30_000 });
    await vi.advanceTimersByTimeAsync(0);

    expect(() => {
      stop();
      stop();
    }).not.toThrow();
  });

  it("verbose stop message includes scan count and change count", async () => {
    orchestrate
      .mockResolvedValueOnce({ tasks: [taskA] })
      .mockResolvedValueOnce({ tasks: [taskA, taskB] });
    formatFn.mockReturnValue("TABLE");

    const stop = watch({ intervalMs: 30_000, verbose: true });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    stop();

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Stopped after 2 scan(s), 1 total change(s) detected"),
    );
  });

  it("task added and removed in same poll cycle shows both", async () => {
    // First poll: [A, B]. Second poll: [A, C]. B removed, C added.
    orchestrate
      .mockResolvedValueOnce({ tasks: [taskA, taskB] })
      .mockResolvedValueOnce({ tasks: [taskA, taskC] });
    formatFn.mockReturnValue("TABLE");
    const onChanges = vi.fn();

    const stop = watch({ intervalMs: 30_000, onChanges });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(onChanges).toHaveBeenCalledTimes(1);
    const changes = onChanges.mock.calls[0][0];
    expect(changes.added).toHaveLength(1);
    expect(changes.added[0].name).toBe("cleanup");
    expect(changes.removed).toHaveLength(1);
    expect(changes.removed[0].name).toBe("daily-report");
    stop();
  });
});

// ── Additional diffTasks edge cases ──────────────────────────────────

describe("diffTasks edge cases", () => {
  it("task name changes but schedule stays same — detected as add + remove", () => {
    const oldTask: ScheduledTask = { name: "old-name", schedule: "0 3 * * *", source: "crontab" };
    const newTask: ScheduledTask = { name: "new-name", schedule: "0 3 * * *", source: "crontab" };

    const changes = diffTasks([oldTask], [newTask]);

    expect(changes.added).toHaveLength(1);
    expect(changes.added[0].name).toBe("new-name");
    expect(changes.removed).toHaveLength(1);
    expect(changes.removed[0].name).toBe("old-name");
    expect(changes.modified).toHaveLength(0);
  });

  it("duplicate tasks in current list — last one wins in map", () => {
    const t1: ScheduledTask = { name: "dup", schedule: "0 1 * * *", source: "s" };
    const t2: ScheduledTask = { name: "dup", schedule: "0 2 * * *", source: "s" };

    const changes = diffTasks([], [t1, t2]);

    // Map uses taskKey, so t2 overwrites t1. Only 1 added.
    expect(changes.added).toHaveLength(1);
    expect(changes.added[0].schedule).toBe("0 2 * * *");
  });

  it("all tasks removed", () => {
    const changes = diffTasks([taskA, taskB, taskC], []);

    expect(changes.added).toHaveLength(0);
    expect(changes.removed).toHaveLength(3);
    expect(changes.modified).toHaveLength(0);
  });

  it("all tasks added from empty", () => {
    const changes = diffTasks([], [taskA, taskB, taskC]);

    expect(changes.added).toHaveLength(3);
    expect(changes.removed).toHaveLength(0);
    expect(changes.modified).toHaveLength(0);
  });

  it("non-schedule fields change — not detected as modification", () => {
    const before: ScheduledTask = { name: "job", schedule: "0 * * * *", source: "s", command: "echo hi" };
    const after: ScheduledTask = { name: "job", schedule: "0 * * * *", source: "s", command: "echo bye", description: "updated" };

    const changes = diffTasks([before], [after]);

    expect(changes.modified).toHaveLength(0);
    expect(changes.added).toHaveLength(0);
    expect(changes.removed).toHaveLength(0);
  });

  it("timestamp is set to a Date on every call", () => {
    const changes = diffTasks([], []);
    expect(changes.timestamp).toBeInstanceOf(Date);
  });
});

// ── Additional parseDuration edge cases ──────────────────────────────

describe("parseDuration edge cases", () => {
  it("rejects 'ms' unit", () => {
    expect(() => parseDuration("500ms")).toThrow("Invalid duration");
  });

  it("rejects '0s'", () => {
    expect(() => parseDuration("0s")).toThrow("at least 10 seconds");
  });

  it("rejects negative-looking input", () => {
    expect(() => parseDuration("-5s")).toThrow("Invalid duration");
  });

  it("rejects just a unit with no number", () => {
    expect(() => parseDuration("s")).toThrow("Invalid duration");
  });

  it("rejects decimal values", () => {
    expect(() => parseDuration("1.5m")).toThrow("Invalid duration");
  });

  it("parses uppercase units", () => {
    expect(parseDuration("30S")).toBe(30_000);
    expect(parseDuration("1M")).toBe(60_000);
    expect(parseDuration("1H")).toBe(3_600_000);
  });

  it("rejects 9s (just below minimum)", () => {
    expect(() => parseDuration("9s")).toThrow("at least 10 seconds");
  });

  it("accepts large values", () => {
    expect(parseDuration("24h")).toBe(86_400_000);
    expect(parseDuration("100m")).toBe(6_000_000);
  });

  it("rejects input with extra characters", () => {
    expect(() => parseDuration("30sec")).toThrow("Invalid duration");
    expect(() => parseDuration("5 minutes")).toThrow("Invalid duration");
  });
});

// ── formatChanges edge cases ─────────────────────────────────────────

describe("formatChanges edge cases", () => {
  it("singular 'change' when exactly 1 change", () => {
    const output = formatChanges({
      added: [taskA],
      removed: [],
      modified: [],
      timestamp: new Date("2026-01-01T00:00:00Z"),
    });
    expect(output).toContain("1 change detected:");
    expect(output).not.toContain("1 changes");
  });

  it("zero changes returns '0 changes detected'", () => {
    const output = formatChanges({
      added: [],
      removed: [],
      modified: [],
      timestamp: new Date("2026-01-01T00:00:00Z"),
    });
    expect(output).toContain("0 changes detected:");
  });
});
