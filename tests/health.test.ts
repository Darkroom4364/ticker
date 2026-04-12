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

    describe("equivalent every-minute expressions", () => {
      it("detects */1 step syntax as every-minute", () => {
        const report = checkHealth([
          makeTask({ name: "stepper", schedule: "*/1 * * * *", source: "crontab" }),
        ]);
        const w = report.warnings.find((w) => w.code === "TOO_FREQUENT");
        expect(w).toBeDefined();
        expect(w!.tasks[0].name).toBe("stepper");
      });

      it("detects 0-59 full range as every-minute", () => {
        const report = checkHealth([
          makeTask({ name: "ranger", schedule: "0-59 * * * *", source: "crontab" }),
        ]);
        const w = report.warnings.find((w) => w.code === "TOO_FREQUENT");
        expect(w).toBeDefined();
        expect(w!.tasks[0].name).toBe("ranger");
      });
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

  describe("edge cases: empty/weird fields", () => {
    it("handles task with empty string name, source, and schedule", () => {
      const report = checkHealth([
        makeTask({ name: "", schedule: "", source: "" }),
      ]);
      // empty schedule is not 5 fields, so no TOO_FREQUENT
      // nextRun is set by default, so no NO_NEXT_RUN
      expect(report.totalTasks).toBe(1);
    });

    it("handles task with whitespace-only name", () => {
      const report = checkHealth([
        makeTask({ name: "   ", schedule: "0 3 * * *", source: "crontab" }),
      ]);
      expect(report.totalTasks).toBe(1);
      expect(report.healthyTasks).toBe(1);
    });

    it("handles task with extremely long name (1000+ chars)", () => {
      const longName = "a".repeat(1500);
      const report = checkHealth([
        makeTask({ name: longName, schedule: "0 3 * * *", source: "crontab" }),
      ]);
      expect(report.totalTasks).toBe(1);
      expect(report.healthyTasks).toBe(1);
      // the name should appear in messages if warnings are triggered
    });

    it("handles task with unicode/emoji in name and source", () => {
      const report = checkHealth([
        makeTask({ name: "🚀 deploy ñoño", schedule: "0 3 * * *", source: "kübernetes 🐳" }),
      ]);
      expect(report.totalTasks).toBe(1);
      expect(report.healthyTasks).toBe(1);
    });

    it("throws when schedule is undefined (null/undefined fields)", () => {
      expect(() =>
        checkHealth([
          makeTask({
            name: null as unknown as string,
            schedule: undefined as unknown as string,
            source: "crontab",
          }),
        ]),
      ).toThrow();
    });

    it("handles task with invalid cron (random string) schedule", () => {
      const report = checkHealth([
        makeTask({ name: "bad-cron", schedule: "not a cron at all", source: "crontab" }),
      ]);
      // not 5 fields, so TOO_FREQUENT won't trigger; no crash expected
      expect(report.totalTasks).toBe(1);
    });

    it("handles task with interval field set alongside cron schedule", () => {
      const report = checkHealth([
        makeTask({
          name: "interval-job",
          schedule: "0 3 * * *",
          source: "systemd",
          interval: "Every day at 3:00 AM",
        }),
      ]);
      expect(report.totalTasks).toBe(1);
      expect(report.healthyTasks).toBe(1);
    });
  });

  describe("edge cases: nextRun boundaries", () => {
    it("handles nextRun in the far past (year 1970, epoch)", () => {
      const report = checkHealth([
        makeTask({ name: "epoch-job", schedule: "0 0 * * *", source: "crontab", nextRun: new Date(0) }),
      ]);
      // Date(0) is in the past, so nextRun - now < 0, STALE_EXPRESSION should NOT fire
      const stale = report.warnings.filter((w) => w.code === "STALE_EXPRESSION");
      expect(stale).toHaveLength(0);
      expect(report.totalTasks).toBe(1);
    });

    it("handles nextRun in the far future (year 9999)", () => {
      const report = checkHealth([
        makeTask({ name: "far-future", schedule: "0 0 1 1 *", source: "crontab", nextRun: new Date("9999-12-31T23:59:59Z") }),
      ]);
      const stale = report.warnings.find((w) => w.code === "STALE_EXPRESSION");
      expect(stale).toBeDefined();
      expect(stale!.message).toContain("more than a year away");
    });

    it("does not flag nextRun exactly 365 days away as stale", () => {
      const nextRun = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const report = checkHealth([
        makeTask({ name: "yearly", schedule: "0 0 1 1 *", source: "crontab", nextRun }),
      ]);
      const stale = report.warnings.filter((w) => w.code === "STALE_EXPRESSION");
      expect(stale).toHaveLength(0);
    });

    it("does not flag nextRun exactly 366 days away as stale", () => {
      const nextRun = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000);
      const report = checkHealth([
        makeTask({ name: "leap-yearly", schedule: "0 0 29 2 *", source: "crontab", nextRun }),
      ]);
      const stale = report.warnings.filter((w) => w.code === "STALE_EXPRESSION");
      expect(stale).toHaveLength(0);
    });

    it("flags nextRun at 367 days away as stale", () => {
      const nextRun = new Date(Date.now() + 367 * 24 * 60 * 60 * 1000);
      const report = checkHealth([
        makeTask({ name: "stale-yearly", schedule: "0 0 29 2 *", source: "crontab", nextRun }),
      ]);
      const stale = report.warnings.find((w) => w.code === "STALE_EXPRESSION");
      expect(stale).toBeDefined();
    });
  });

  describe("edge cases: names differing by whitespace or case", () => {
    it("does not treat names differing only by case as overlapping", () => {
      const report = checkHealth([
        makeTask({ name: "Backup", schedule: "0 3 * * *", source: "crontab" }),
        makeTask({ name: "backup", schedule: "0 4 * * *", source: "kubernetes" }),
      ]);
      // name matching is case-sensitive, so these are different names
      const overlap = report.warnings.filter((w) => w.code === "OVERLAPPING_NAMES");
      expect(overlap).toHaveLength(0);
    });

    it("does not treat names differing only by whitespace as overlapping", () => {
      const report = checkHealth([
        makeTask({ name: "backup ", schedule: "0 3 * * *", source: "crontab" }),
        makeTask({ name: "backup", schedule: "0 4 * * *", source: "kubernetes" }),
      ]);
      const overlap = report.warnings.filter((w) => w.code === "OVERLAPPING_NAMES");
      expect(overlap).toHaveLength(0);
    });
  });

  describe("edge cases: duplicate detection at scale", () => {
    it("handles hundreds of tasks with same schedule from same source", () => {
      const tasks = Array.from({ length: 200 }, (_, i) =>
        makeTask({ name: `job-${i}`, schedule: "0 3 * * *", source: "kubernetes" }),
      );
      const report = checkHealth(tasks);
      const dup = report.warnings.find((w) => w.code === "DUPLICATE_SCHEDULE");
      expect(dup).toBeDefined();
      expect(dup!.tasks).toHaveLength(200);
      expect(dup!.message).toContain("200 tasks");
    });

    it("handles tasks with overlapping names across 10+ sources", () => {
      const sources = Array.from({ length: 12 }, (_, i) => `source-${i}`);
      const tasks = sources.map((src) =>
        makeTask({ name: "shared-job", schedule: "0 3 * * *", source: src }),
      );
      const report = checkHealth(tasks);
      const overlap = report.warnings.find((w) => w.code === "OVERLAPPING_NAMES");
      expect(overlap).toBeDefined();
      expect(overlap!.tasks).toHaveLength(12);
      // All 12 sources should be mentioned
      for (const src of sources) {
        expect(overlap!.message).toContain(src);
      }
    });
  });

  describe("edge cases: suspended metadata variants", () => {
    it("detects suspended='true' as string (not boolean)", () => {
      const report = checkHealth([
        makeTask({
          name: "string-suspended",
          schedule: "0 3 * * *",
          source: "kubernetes",
          metadata: { suspended: "true" },
        }),
      ]);
      const w = report.warnings.find((w) => w.code === "SUSPENDED");
      expect(w).toBeDefined();
    });

    it("detects status with mixed case 'Suspended'", () => {
      const report = checkHealth([
        makeTask({
          name: "mixed-case-job",
          schedule: "0 3 * * *",
          source: "kubernetes",
          metadata: { status: "Suspended" },
        }),
      ]);
      const w = report.warnings.find((w) => w.code === "SUSPENDED");
      expect(w).toBeDefined();
    });

    it("detects status with upper case 'DISABLED'", () => {
      const report = checkHealth([
        makeTask({
          name: "upper-disabled",
          schedule: "0 3 * * *",
          source: "kubernetes",
          metadata: { status: "DISABLED" },
        }),
      ]);
      const w = report.warnings.find((w) => w.code === "SUSPENDED");
      expect(w).toBeDefined();
    });

    it("detects mixed-case key 'Suspended' with value 'True'", () => {
      const report = checkHealth([
        makeTask({
          name: "mixed-key",
          schedule: "0 3 * * *",
          source: "kubernetes",
          metadata: { Suspended: "True" },
        }),
      ]);
      const w = report.warnings.find((w) => w.code === "SUSPENDED");
      expect(w).toBeDefined();
    });
  });

  describe("edge cases: every-minute + duplicate combo", () => {
    it("produces both TOO_FREQUENT and DUPLICATE_SCHEDULE warnings", () => {
      const report = checkHealth([
        makeTask({ name: "poller-a", schedule: "* * * * *", source: "crontab" }),
        makeTask({ name: "poller-b", schedule: "* * * * *", source: "crontab" }),
      ]);
      const codes = report.warnings.map((w) => w.code);
      expect(codes).toContain("TOO_FREQUENT");
      expect(codes).toContain("DUPLICATE_SCHEDULE");
      // Both pollers get TOO_FREQUENT, and both share schedule = DUPLICATE
      const tooFreq = report.warnings.filter((w) => w.code === "TOO_FREQUENT");
      expect(tooFreq).toHaveLength(2);
    });
  });

  describe("edge cases: single task", () => {
    it("single task cannot trigger DUPLICATE_SCHEDULE or OVERLAPPING_NAMES", () => {
      const report = checkHealth([
        makeTask({ name: "solo", schedule: "0 3 * * *", source: "crontab" }),
      ]);
      const dup = report.warnings.filter((w) => w.code === "DUPLICATE_SCHEDULE");
      const overlap = report.warnings.filter((w) => w.code === "OVERLAPPING_NAMES");
      expect(dup).toHaveLength(0);
      expect(overlap).toHaveLength(0);
      expect(report.healthyTasks).toBe(1);
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
