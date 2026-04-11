import { describe, it, expect } from "vitest";
import { checkHealth, formatHealthReport } from "../src/health.js";
import type { ScheduledTask } from "../src/types.js";

function makeTask(overrides: Partial<ScheduledTask> & { name: string; schedule: string; source: string }): ScheduledTask {
  return {
    nextRun: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow by default
    ...overrides,
  };
}

describe("checkHealth", () => {
  it("returns clean report for empty task list", () => {
    const report = checkHealth([]);
    expect(report.totalTasks).toBe(0);
    expect(report.healthyTasks).toBe(0);
    expect(report.warnings).toHaveLength(0);
  });

  it("returns clean report for a single healthy task", () => {
    const report = checkHealth([
      makeTask({ name: "backup", schedule: "0 3 * * *", source: "crontab" }),
    ]);
    expect(report.totalTasks).toBe(1);
    expect(report.healthyTasks).toBe(1);
    expect(report.warnings).toHaveLength(0);
  });

  describe("TOO_FREQUENT", () => {
    it("detects every-minute cron expression", () => {
      const report = checkHealth([
        makeTask({ name: "poller", schedule: "* * * * *", source: "crontab" }),
      ]);
      const w = report.warnings.find((w) => w.code === "TOO_FREQUENT");
      expect(w).toBeDefined();
      expect(w!.level).toBe("warning");
      expect(w!.tasks).toHaveLength(1);
      expect(w!.tasks[0].name).toBe("poller");
    });

    it("does not flag less-frequent expressions", () => {
      const report = checkHealth([
        makeTask({ name: "hourly", schedule: "0 * * * *", source: "crontab" }),
        makeTask({ name: "every5", schedule: "*/5 * * * *", source: "crontab" }),
      ]);
      const w = report.warnings.filter((w) => w.code === "TOO_FREQUENT");
      expect(w).toHaveLength(0);
    });
  });

  describe("DUPLICATE_SCHEDULE", () => {
    it("detects two tasks with same schedule from same source", () => {
      const report = checkHealth([
        makeTask({ name: "backup-a", schedule: "0 3 * * *", source: "kubernetes" }),
        makeTask({ name: "backup-b", schedule: "0 3 * * *", source: "kubernetes" }),
      ]);
      const w = report.warnings.find((w) => w.code === "DUPLICATE_SCHEDULE");
      expect(w).toBeDefined();
      expect(w!.level).toBe("warning");
      expect(w!.tasks).toHaveLength(2);
      expect(w!.message).toContain("kubernetes");
    });

    it("does not flag same schedule from different sources", () => {
      const report = checkHealth([
        makeTask({ name: "backup-a", schedule: "0 3 * * *", source: "crontab" }),
        makeTask({ name: "backup-b", schedule: "0 3 * * *", source: "kubernetes" }),
      ]);
      const w = report.warnings.filter((w) => w.code === "DUPLICATE_SCHEDULE");
      expect(w).toHaveLength(0);
    });
  });

  describe("OVERLAPPING_NAMES", () => {
    it("detects same name from different sources", () => {
      const report = checkHealth([
        makeTask({ name: "daily-report", schedule: "0 9 * * *", source: "crontab" }),
        makeTask({ name: "daily-report", schedule: "0 10 * * *", source: "kubernetes" }),
      ]);
      const w = report.warnings.find((w) => w.code === "OVERLAPPING_NAMES");
      expect(w).toBeDefined();
      expect(w!.level).toBe("info");
      expect(w!.message).toContain("daily-report");
      expect(w!.message).toContain("crontab");
      expect(w!.message).toContain("kubernetes");
    });

    it("does not flag same name from same source", () => {
      const report = checkHealth([
        makeTask({ name: "backup", schedule: "0 3 * * *", source: "crontab" }),
        makeTask({ name: "backup", schedule: "0 4 * * *", source: "crontab" }),
      ]);
      const w = report.warnings.filter((w) => w.code === "OVERLAPPING_NAMES");
      expect(w).toHaveLength(0);
    });
  });

  describe("SUSPENDED", () => {
    it("detects tasks with suspended metadata", () => {
      const report = checkHealth([
        makeTask({
          name: "paused-job",
          schedule: "0 3 * * *",
          source: "kubernetes",
          metadata: { suspended: "true" },
        }),
      ]);
      const w = report.warnings.find((w) => w.code === "SUSPENDED");
      expect(w).toBeDefined();
      expect(w!.level).toBe("info");
    });

    it("detects tasks with disabled metadata", () => {
      const report = checkHealth([
        makeTask({
          name: "disabled-job",
          schedule: "0 3 * * *",
          source: "crontab",
          metadata: { enabled: "false" },
        }),
      ]);
      const w = report.warnings.find((w) => w.code === "SUSPENDED");
      expect(w).toBeDefined();
    });

    it("detects tasks with status=inactive metadata", () => {
      const report = checkHealth([
        makeTask({
          name: "inactive-job",
          schedule: "0 3 * * *",
          source: "systemd",
          metadata: { status: "inactive" },
        }),
      ]);
      const w = report.warnings.find((w) => w.code === "SUSPENDED");
      expect(w).toBeDefined();
    });

    it("does not flag tasks without suspension metadata", () => {
      const report = checkHealth([
        makeTask({
          name: "active-job",
          schedule: "0 3 * * *",
          source: "crontab",
          metadata: { owner: "admin" },
        }),
      ]);
      const w = report.warnings.filter((w) => w.code === "SUSPENDED");
      expect(w).toHaveLength(0);
    });
  });

  describe("NO_NEXT_RUN", () => {
    it("detects tasks with no nextRun", () => {
      const report = checkHealth([
        makeTask({ name: "broken", schedule: "invalid", source: "crontab", nextRun: undefined }),
      ]);
      const w = report.warnings.find((w) => w.code === "NO_NEXT_RUN");
      expect(w).toBeDefined();
      expect(w!.level).toBe("warning");
    });

    it("does not flag @reboot tasks without nextRun", () => {
      const report = checkHealth([
        makeTask({ name: "startup", schedule: "@reboot", source: "crontab", nextRun: undefined }),
      ]);
      const w = report.warnings.filter((w) => w.code === "NO_NEXT_RUN");
      expect(w).toHaveLength(0);
    });
  });

  describe("STALE_EXPRESSION", () => {
    it("detects tasks with nextRun more than 366 days away", () => {
      const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
      const report = checkHealth([
        makeTask({ name: "leap-job", schedule: "0 0 29 2 *", source: "crontab", nextRun: farFuture }),
      ]);
      const w = report.warnings.find((w) => w.code === "STALE_EXPRESSION");
      expect(w).toBeDefined();
      expect(w!.level).toBe("warning");
      expect(w!.message).toContain("more than a year away");
    });

    it("does not flag tasks with nextRun within 366 days", () => {
      const nearFuture = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
      const report = checkHealth([
        makeTask({ name: "monthly", schedule: "0 0 1 * *", source: "crontab", nextRun: nearFuture }),
      ]);
      const w = report.warnings.filter((w) => w.code === "STALE_EXPRESSION");
      expect(w).toHaveLength(0);
    });
  });

  describe("multiple warnings", () => {
    it("reports multiple warnings at once", () => {
      const report = checkHealth([
        makeTask({ name: "poller", schedule: "* * * * *", source: "crontab" }),
        makeTask({ name: "broken", schedule: "bad", source: "crontab", nextRun: undefined }),
        makeTask({ name: "daily-report", schedule: "0 9 * * *", source: "crontab" }),
        makeTask({ name: "daily-report", schedule: "0 10 * * *", source: "kubernetes" }),
      ]);
      const codes = report.warnings.map((w) => w.code);
      expect(codes).toContain("TOO_FREQUENT");
      expect(codes).toContain("NO_NEXT_RUN");
      expect(codes).toContain("OVERLAPPING_NAMES");
      expect(report.totalTasks).toBe(4);
      // poller has TOO_FREQUENT, broken has NO_NEXT_RUN, both daily-reports have OVERLAPPING_NAMES
      // So all 4 tasks are unhealthy
      expect(report.healthyTasks).toBe(0);
    });
  });
});

describe("formatHealthReport", () => {
  it("formats clean report", () => {
    const output = formatHealthReport({ warnings: [], totalTasks: 5, healthyTasks: 5 });
    expect(output).toContain("5 tasks analyzed");
    expect(output).toContain("all healthy");
  });

  it("uses [WARN] prefix for warnings", () => {
    const report = checkHealth([
      makeTask({ name: "poller", schedule: "* * * * *", source: "crontab" }),
    ]);
    const output = formatHealthReport(report);
    expect(output).toContain("[WARN]");
    expect(output).toContain("TOO_FREQUENT");
  });

  it("uses [INFO] prefix for info-level warnings", () => {
    const report = checkHealth([
      makeTask({ name: "job", schedule: "0 3 * * *", source: "crontab" }),
      makeTask({ name: "job", schedule: "0 4 * * *", source: "kubernetes" }),
    ]);
    const output = formatHealthReport(report);
    expect(output).toContain("[INFO]");
    expect(output).toContain("OVERLAPPING_NAMES");
  });

  it("includes warning and info counts in summary", () => {
    const report = checkHealth([
      makeTask({ name: "poller", schedule: "* * * * *", source: "crontab" }),
      makeTask({ name: "job", schedule: "0 3 * * *", source: "crontab" }),
      makeTask({ name: "job", schedule: "0 4 * * *", source: "kubernetes" }),
    ]);
    const output = formatHealthReport(report);
    expect(output).toContain("3 tasks analyzed");
    expect(output).toContain("1 warning");
    expect(output).toContain("1 info");
  });

  it("uses [ERROR] prefix for error-level warnings", () => {
    const report: import("../src/health.js").HealthReport = {
      warnings: [{
        level: "error",
        code: "CRITICAL",
        message: "something is very wrong",
        tasks: [],
      }],
      totalTasks: 1,
      healthyTasks: 0,
    };
    const output = formatHealthReport(report);
    expect(output).toContain("[ERROR]");
  });
});
