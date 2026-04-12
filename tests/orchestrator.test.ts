import { describe, it, expect, vi, beforeEach } from "vitest";
import { PartialScanError } from "../src/types.js";
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

  it("all-failed: every result has error when all scanners fail", async () => {
    const bad1 = createMockScanner("bad-1", [], {
      error: new Error("fail-1"),
    });
    const bad2 = createMockScanner("bad-2", [], {
      error: new Error("fail-2"),
    });

    const { tasks, results } = await orchestrate({}, [bad1, bad2]);

    expect(tasks).toHaveLength(0);
    expect(results).toHaveLength(2);
    // This is the condition src/cli.ts:48 checks for exit code 1
    const allFailed = results.length > 0 && results.every((r) => r.error);
    expect(allFailed).toBe(true);
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

  it("extracts partial tasks from PartialScanError and still reports error", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write");
    const partialScanner: Scanner = {
      name: "partial",
      isAvailable: vi.fn().mockResolvedValue(true),
      scan: vi.fn().mockRejectedValue(
        new PartialScanError("page 2 failed", [TASK_A])
      ),
    };

    const { tasks, results } = await orchestrate({}, [partialScanner]);

    // Should include the partial task
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("task-a");
    // Should also report the error
    expect(results[0].error).toBe("page 2 failed");
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Warning: Scanner 'partial' failed: page 2 failed")
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

  // ── Edge cases ───────────────────────────────────────────────────────

  it("all scanners unavailable returns zero tasks", async () => {
    const s1 = createMockScanner("s1", [TASK_A], { available: false });
    const s2 = createMockScanner("s2", [TASK_B], { available: false });

    const { tasks, results } = await orchestrate({}, [s1, s2]);

    expect(tasks).toHaveLength(0);
    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.error)).toBe(true);
    expect(s1.scan).not.toHaveBeenCalled();
    expect(s2.scan).not.toHaveBeenCalled();
  });

  it("all scanners throw errors", async () => {
    const s1 = createMockScanner("s1", [], { error: new Error("e1") });
    const s2 = createMockScanner("s2", [], { error: new Error("e2") });
    const s3 = createMockScanner("s3", [], { error: new Error("e3") });

    const { tasks, results } = await orchestrate({}, [s1, s2, s3]);

    expect(tasks).toHaveLength(0);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.error)).toBe(true);
  });

  it("scanner scan() returns empty array", async () => {
    const scanner = createMockScanner("empty", []);

    const { tasks, results } = await orchestrate({}, [scanner]);

    expect(tasks).toHaveLength(0);
    expect(results[0].tasks).toHaveLength(0);
    expect(results[0].error).toBeUndefined();
  });

  it("mix of successful, failed, and unavailable scanners", async () => {
    const good = createMockScanner("good", [TASK_A]);
    const bad = createMockScanner("bad", [], { error: new Error("fail") });
    const unavail = createMockScanner("unavail", [], { available: false });

    const { tasks, results } = await orchestrate({}, [good, bad, unavail]);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("task-a");
    expect(results).toHaveLength(3);

    const goodR = results.find((r) => r.scanner === "good")!;
    expect(goodR.error).toBeUndefined();
    expect(goodR.tasks).toHaveLength(1);

    const badR = results.find((r) => r.scanner === "bad")!;
    expect(badR.error).toBe("fail");

    const unavailR = results.find((r) => r.scanner === "unavail")!;
    expect(unavailR.error).toBeUndefined();
    expect(unavailR.tasks).toHaveLength(0);
  });

  it("scanners returning tasks with identical names from different sources", async () => {
    const t1: ScheduledTask = { name: "backup", schedule: "0 3 * * *", source: "s1", nextRun: new Date("2025-06-16T03:00:00") };
    const t2: ScheduledTask = { name: "backup", schedule: "0 4 * * *", source: "s2", nextRun: new Date("2025-06-16T04:00:00") };
    const s1 = createMockScanner("s1", [t1]);
    const s2 = createMockScanner("s2", [t2]);

    const { tasks } = await orchestrate({}, [s1, s2]);

    expect(tasks).toHaveLength(2);
    // Both should be present, sorted by nextRun
    expect(tasks[0].source).toBe("s1");
    expect(tasks[1].source).toBe("s2");
  });

  it("scanners returning tasks with identical names from same source", async () => {
    const t1: ScheduledTask = { name: "dup", schedule: "0 1 * * *", source: "src", nextRun: new Date("2025-06-16T01:00:00") };
    const t2: ScheduledTask = { name: "dup", schedule: "0 2 * * *", source: "src", nextRun: new Date("2025-06-16T02:00:00") };
    const scanner = createMockScanner("src", [t1, t2]);

    const { tasks } = await orchestrate({}, [scanner]);

    // orchestrate does not deduplicate — it just collects
    expect(tasks).toHaveLength(2);
  });

  it("sorts tasks with null nextRun to the end", async () => {
    const withRun: ScheduledTask = { name: "with-run", schedule: "0 5 * * *", source: "s", nextRun: new Date("2025-06-16T05:00:00") };
    const noRun1: ScheduledTask = { name: "no-run-a", schedule: "@reboot", source: "s" };
    const noRun2: ScheduledTask = { name: "no-run-b", schedule: "@yearly", source: "s" };
    const scanner = createMockScanner("s", [noRun1, withRun, noRun2]);

    const { tasks } = await orchestrate({}, [scanner]);

    expect(tasks[0].name).toBe("with-run");
    expect(tasks[1].name).toBe("no-run-a");
    expect(tasks[2].name).toBe("no-run-b");
  });

  it("handles 20+ scanners concurrently", async () => {
    const scanners: Scanner[] = [];
    for (let i = 0; i < 25; i++) {
      const task: ScheduledTask = {
        name: `task-${i}`,
        schedule: `${i} * * * *`,
        source: `scanner-${i}`,
        nextRun: new Date(`2025-06-16T00:${String(i).padStart(2, "0")}:00`),
      };
      scanners.push(createMockScanner(`scanner-${i}`, [task]));
    }

    const { tasks, results } = await orchestrate({}, scanners);

    expect(results).toHaveLength(25);
    expect(tasks).toHaveLength(25);
    // Should be sorted by nextRun
    for (let i = 0; i < 24; i++) {
      expect(tasks[i].nextRun!.getTime()).toBeLessThanOrEqual(tasks[i + 1].nextRun!.getTime());
    }
  });

  it("PartialScanError with empty tasks array", async () => {
    const scanner: Scanner = {
      name: "partial-empty",
      isAvailable: vi.fn().mockResolvedValue(true),
      scan: vi.fn().mockRejectedValue(new PartialScanError("all failed", [])),
    };

    const { tasks, results } = await orchestrate({}, [scanner]);

    expect(tasks).toHaveLength(0);
    expect(results[0].error).toBe("all failed");
    expect(results[0].tasks).toHaveLength(0);
  });

  it("PartialScanError with null message coerced to string", async () => {
    const scanner: Scanner = {
      name: "partial-null-msg",
      isAvailable: vi.fn().mockResolvedValue(true),
      scan: vi.fn().mockRejectedValue(new PartialScanError(null as unknown as string, [TASK_A])),
    };

    const { tasks, results } = await orchestrate({}, [scanner]);

    expect(tasks).toHaveLength(1);
    expect(results[0].error).toBeDefined();
  });

  it("filtering with --scanners: valid scanner name", async () => {
    const s1 = createMockScanner("alpha", [TASK_A]);
    const s2 = createMockScanner("beta", [TASK_B]);

    const { results } = await orchestrate({ scanners: ["beta"] }, [s1, s2]);

    expect(results).toHaveLength(1);
    expect(results[0].scanner).toBe("beta");
  });

  it("filtering with --scanners: invalid scanner name returns empty", async () => {
    const s1 = createMockScanner("alpha", [TASK_A]);

    const { tasks, results } = await orchestrate({ scanners: ["does-not-exist"] }, [s1]);

    expect(results).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });

  it("filtering with --scanners: empty array runs no scanners", async () => {
    const s1 = createMockScanner("alpha", [TASK_A]);

    const { tasks, results } = await orchestrate({ scanners: [] }, [s1]);

    expect(results).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });

  it("scanner returning non-Error throwable is stringified", async () => {
    const scanner: Scanner = {
      name: "string-thrower",
      isAvailable: vi.fn().mockResolvedValue(true),
      scan: vi.fn().mockRejectedValue("raw string error"),
    };

    const { results } = await orchestrate({}, [scanner]);

    expect(results[0].error).toBe("raw string error");
    expect(results[0].tasks).toHaveLength(0);
  });

  it("isAvailable() throwing does not call scan()", async () => {
    const scanner: Scanner = {
      name: "isavail-throws",
      isAvailable: vi.fn().mockRejectedValue(new Error("boom")),
      scan: vi.fn(),
    };

    await orchestrate({}, [scanner]);

    expect(scanner.scan).not.toHaveBeenCalled();
  });

  it("records durationMs for each scanner result", async () => {
    const scanner = createMockScanner("timed", [TASK_A]);

    const { results } = await orchestrate({}, [scanner]);

    expect(typeof results[0].durationMs).toBe("number");
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("mix of PartialScanError and successful scanners merges tasks", async () => {
    const partial: Scanner = {
      name: "partial",
      isAvailable: vi.fn().mockResolvedValue(true),
      scan: vi.fn().mockRejectedValue(new PartialScanError("half done", [TASK_A])),
    };
    const good = createMockScanner("good", [TASK_EARLY]);

    const { tasks, results } = await orchestrate({}, [partial, good]);

    expect(tasks).toHaveLength(2);
    // TASK_EARLY has earlier nextRun than TASK_A
    expect(tasks[0].name).toBe("task-early");
    expect(tasks[1].name).toBe("task-a");
    expect(results.find((r) => r.scanner === "partial")!.error).toBe("half done");
    expect(results.find((r) => r.scanner === "good")!.error).toBeUndefined();
  });
});
