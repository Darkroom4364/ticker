import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Scanner, ScanOptions, ScheduledTask } from "../src/types.js";
import { orchestrate } from "../src/orchestrator.js";

/** Creates a mock scanner for testing */
function createMockScanner(
  name: string,
  tasks: ScheduledTask[],
  opts?: { available?: boolean; error?: Error }
): Scanner {
  return {
    name,
    isAvailable: vi.fn().mockResolvedValue(opts?.available ?? true),
    scan: opts?.error
      ? vi.fn().mockRejectedValue(opts.error)
      : vi.fn().mockResolvedValue(tasks),
  };
}

const NOW = new Date("2025-06-15T10:30:00");

const TASK_A: ScheduledTask = {
  name: "task-a",
  schedule: "0 2 * * *",
  source: "mock-a",
  nextRun: new Date("2025-06-16T02:00:00"),
  interval: "Every day at 2 AM",
};

const TASK_B: ScheduledTask = {
  name: "task-b",
  schedule: "0 9 * * 1",
  source: "mock-b",
  nextRun: new Date("2025-06-16T09:00:00"),
  interval: "Every Monday at 9 AM",
};

const TASK_C: ScheduledTask = {
  name: "task-c",
  schedule: "@reboot",
  source: "mock-a",
  interval: "At system reboot",
  // No nextRun
};

const TASK_EARLY: ScheduledTask = {
  name: "task-early",
  schedule: "*/5 * * * *",
  source: "mock-b",
  nextRun: new Date("2025-06-15T10:35:00"),
  interval: "Every 5 minutes",
};

describe("orchestrate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Suppress stderr output in tests
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("runs all scanners and collects results", async () => {
    const scannerA = createMockScanner("mock-a", [TASK_A, TASK_C]);
    const scannerB = createMockScanner("mock-b", [TASK_B]);

    const { tasks, results } = await orchestrate({}, [scannerA, scannerB]);

    expect(results).toHaveLength(2);
    expect(tasks).toHaveLength(3);
  });

  it("sorts results by nextRun time (nulls last)", async () => {
    const scannerA = createMockScanner("mock-a", [TASK_A, TASK_C]);
    const scannerB = createMockScanner("mock-b", [TASK_EARLY]);

    const { tasks } = await orchestrate({}, [scannerA, scannerB]);

    // TASK_EARLY (10:35) < TASK_A (next day 2:00) < TASK_C (no nextRun)
    expect(tasks[0].name).toBe("task-early");
    expect(tasks[1].name).toBe("task-a");
    expect(tasks[2].name).toBe("task-c");
  });

  it("filters to selected scanners via --scanners option", async () => {
    const scannerA = createMockScanner("mock-a", [TASK_A]);
    const scannerB = createMockScanner("mock-b", [TASK_B]);

    const { tasks, results } = await orchestrate(
      { scanners: ["mock-a"] },
      [scannerA, scannerB]
    );

    // Only mock-a should run
    expect(results).toHaveLength(1);
    expect(results[0].scanner).toBe("mock-a");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("task-a");
  });

  it("skips unavailable scanners", async () => {
    const available = createMockScanner("available", [TASK_A]);
    const unavailable = createMockScanner("unavailable", [], {
      available: false,
    });

    const { tasks, results } = await orchestrate({}, [
      available,
      unavailable,
    ]);

    expect(results).toHaveLength(2);
    expect(tasks).toHaveLength(1);
    expect(unavailable.scan).not.toHaveBeenCalled();
  });

  it("handles scanner errors gracefully", async () => {
    const good = createMockScanner("good", [TASK_A]);
    const bad = createMockScanner("bad", [], {
      error: new Error("Connection refused"),
    });

    const { tasks, results } = await orchestrate({}, [good, bad]);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("task-a");

    const badResult = results.find((r) => r.scanner === "bad");
    expect(badResult?.error).toBe("Connection refused");
    expect(badResult?.tasks).toHaveLength(0);
  });

  it("reports errors to stderr", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write");
    const bad = createMockScanner("bad", [], {
      error: new Error("timeout"),
    });

    await orchestrate({}, [bad]);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Warning: Scanner 'bad' failed: timeout")
    );
  });

  it("shows verbose output when verbose option is set", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write");
    const scanner = createMockScanner("verbose-test", [TASK_A]);

    await orchestrate({ verbose: true }, [scanner]);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("[verbose-test] OK (1 tasks)")
    );
  });

  it("returns empty tasks when no scanners match filter", async () => {
    const scanner = createMockScanner("mock-a", [TASK_A]);

    const { tasks, results } = await orchestrate(
      { scanners: ["nonexistent"] },
      [scanner]
    );

    expect(results).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });

  it("shows verbose output for failed scanners", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write");
    const bad = createMockScanner("failing-scanner", [], {
      error: new Error("connection refused"),
    });

    await orchestrate({ verbose: true }, [bad]);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("[failing-scanner] FAILED (connection refused)")
    );
  });

  it("handles isAvailable() throwing an error", async () => {
    const throwingScanner: Scanner = {
      name: "throwing",
      isAvailable: vi.fn().mockRejectedValue(new Error("unexpected")),
      scan: vi.fn().mockResolvedValue([]),
    };

    const { tasks, results } = await orchestrate({}, [throwingScanner]);

    expect(tasks).toHaveLength(0);
    expect(results[0].error).toContain("unexpected");
    expect(throwingScanner.scan).not.toHaveBeenCalled();
  });

  it("sorts two tasks with no nextRun stably", async () => {
    const taskNoRun1: ScheduledTask = {
      name: "no-run-1",
      schedule: "@reboot",
      source: "mock",
      interval: "At system reboot",
    };
    const taskNoRun2: ScheduledTask = {
      name: "no-run-2",
      schedule: "@reboot",
      source: "mock",
      interval: "At system reboot",
    };
    const scanner = createMockScanner("mock", [taskNoRun1, taskNoRun2]);

    const { tasks } = await orchestrate({}, [scanner]);

    expect(tasks).toHaveLength(2);
    // Both have no nextRun — should maintain original order (stable sort)
    expect(tasks[0].name).toBe("no-run-1");
    expect(tasks[1].name).toBe("no-run-2");
  });

  it("runs scanners concurrently", async () => {
    const order: string[] = [];
    const slowScanner: Scanner = {
      name: "slow",
      isAvailable: async () => true,
      scan: async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push("slow");
        return [TASK_A];
      },
    };
    const fastScanner: Scanner = {
      name: "fast",
      isAvailable: async () => true,
      scan: async () => {
        order.push("fast");
        return [TASK_B];
      },
    };

    const { tasks } = await orchestrate({}, [slowScanner, fastScanner]);

    expect(tasks).toHaveLength(2);
    // Fast should complete before slow
    expect(order[0]).toBe("fast");
    expect(order[1]).toBe("slow");
  });
});
