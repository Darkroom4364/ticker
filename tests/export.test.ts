import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScheduledTask } from "../src/types.js";
import { toPrometheus } from "../src/export.js";
import type { ExportOptions } from "../src/export.js";

const NOW = new Date("2025-06-15T10:00:00Z");

function makeTask(overrides: Partial<ScheduledTask> & { name: string; source: string; schedule: string }): ScheduledTask {
  return { ...overrides };
}

describe("toPrometheus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits HELP/TYPE headers with zero value for empty task list (no scannerResults)", () => {
    const output = toPrometheus({ tasks: [] });
    expect(output).toContain("# HELP schedex_jobs_total");
    expect(output).toContain("# TYPE schedex_jobs_total gauge");
    expect(output).toContain("schedex_jobs_total 0");
    expect(output).toContain("# HELP schedex_next_run_seconds");
    expect(output).toContain("# TYPE schedex_next_run_seconds gauge");
  });

  it("emits per-scanner zero counts when scannerResults provided but no tasks", () => {
    const output = toPrometheus({
      tasks: [],
      scannerResults: [
        { scanner: "crontab", tasks: [], durationMs: 10, error: undefined },
        { scanner: "kubernetes", tasks: [], durationMs: 20, error: undefined },
      ],
    });
    expect(output).toContain('schedex_jobs_total{scanner="crontab"} 0');
    expect(output).toContain('schedex_jobs_total{scanner="kubernetes"} 0');
  });

  it("generates correct metrics for a single task", () => {
    const nextRun = new Date("2025-06-15T11:00:00Z"); // 1 hour from NOW
    const task = makeTask({
      name: "backup",
      schedule: "0 * * * *",
      source: "crontab",
      nextRun,
    });
    const output = toPrometheus({ tasks: [task] });

    expect(output).toContain('schedex_jobs_total{scanner="crontab"} 1');
    expect(output).toContain('schedex_next_run_seconds{job="backup",scanner="crontab"} 3600');
  });

  it("groups multiple tasks from different scanners correctly", () => {
    const tasks: ScheduledTask[] = [
      makeTask({ name: "backup", schedule: "0 2 * * *", source: "crontab", nextRun: new Date("2025-06-15T12:00:00Z") }),
      makeTask({ name: "cleanup", schedule: "0 3 * * *", source: "crontab", nextRun: new Date("2025-06-15T13:00:00Z") }),
      makeTask({ name: "deploy", schedule: "0 4 * * *", source: "kubernetes", nextRun: new Date("2025-06-15T14:00:00Z") }),
    ];
    const output = toPrometheus({ tasks });

    expect(output).toContain('schedex_jobs_total{scanner="crontab"} 2');
    expect(output).toContain('schedex_jobs_total{scanner="kubernetes"} 1');
    expect(output).toContain('schedex_next_run_seconds{job="backup",scanner="crontab"}');
    expect(output).toContain('schedex_next_run_seconds{job="cleanup",scanner="crontab"}');
    expect(output).toContain('schedex_next_run_seconds{job="deploy",scanner="kubernetes"}');
  });

  it("omits tasks without nextRun from schedex_next_run_seconds", () => {
    const tasks: ScheduledTask[] = [
      makeTask({ name: "no-next", schedule: "0 * * * *", source: "crontab" }),
      makeTask({ name: "has-next", schedule: "0 * * * *", source: "crontab", nextRun: new Date("2025-06-15T11:00:00Z") }),
    ];
    const output = toPrometheus({ tasks });

    expect(output).toContain('schedex_jobs_total{scanner="crontab"} 2');
    expect(output).not.toContain('job="no_next"');
    expect(output).toContain('schedex_next_run_seconds{job="has_next",scanner="crontab"} 3600');
  });

  it("includes scanner duration metrics when scannerResults provided", () => {
    const output = toPrometheus({
      tasks: [],
      scannerResults: [
        { scanner: "crontab", tasks: [], durationMs: 45 },
        { scanner: "kubernetes", tasks: [], durationMs: 1203 },
      ],
    });

    expect(output).toContain("# HELP schedex_scan_duration_seconds");
    expect(output).toContain("# TYPE schedex_scan_duration_seconds gauge");
    expect(output).toContain('schedex_scan_duration_seconds{scanner="crontab"} 0.045');
    expect(output).toContain('schedex_scan_duration_seconds{scanner="kubernetes"} 1.203');
  });

  it("includes scanner error metrics when errors present", () => {
    const output = toPrometheus({
      tasks: [],
      scannerResults: [
        { scanner: "crontab", tasks: [], durationMs: 10 },
        { scanner: "eventbridge", tasks: [], durationMs: 200, error: "Access denied" },
      ],
    });

    expect(output).toContain("# HELP schedex_scanner_errors_total");
    expect(output).toContain("# TYPE schedex_scanner_errors_total gauge");
    expect(output).toContain('schedex_scanner_errors_total{scanner="eventbridge"} 1');
    expect(output).not.toContain('schedex_scanner_errors_total{scanner="crontab"}');
  });

  it("omits duration and error metrics when no scannerResults provided", () => {
    const output = toPrometheus({
      tasks: [makeTask({ name: "job", schedule: "* * * * *", source: "crontab" })],
    });

    expect(output).not.toContain("schedex_scan_duration_seconds");
    expect(output).not.toContain("schedex_scanner_errors_total");
  });

  it("sanitizes label values (special chars replaced with underscore)", () => {
    const task = makeTask({
      name: "my-backup.job/daily",
      schedule: "0 2 * * *",
      source: "docker-compose",
      nextRun: new Date("2025-06-15T11:00:00Z"),
    });
    const output = toPrometheus({ tasks: [task] });

    expect(output).toContain('scanner="docker_compose"');
    expect(output).toContain('job="my_backup_job_daily"');
    // Ensure the raw unsanitized values are not present
    expect(output).not.toContain('scanner="docker-compose"');
    expect(output).not.toContain('job="my-backup.job/daily"');
  });

  it("outputs valid Prometheus format: HELP before TYPE before values", () => {
    const task = makeTask({
      name: "test",
      schedule: "* * * * *",
      source: "crontab",
      nextRun: new Date("2025-06-15T11:00:00Z"),
    });
    const output = toPrometheus({
      tasks: [task],
      scannerResults: [
        { scanner: "crontab", tasks: [task], durationMs: 50 },
      ],
    });

    const lines = output.split("\n");

    // For each metric family, HELP must come before TYPE which must come before values
    const metricFamilies = ["schedex_jobs_total", "schedex_next_run_seconds", "schedex_scan_duration_seconds"];
    for (const family of metricFamilies) {
      const helpIdx = lines.findIndex((l) => l.startsWith(`# HELP ${family}`));
      const typeIdx = lines.findIndex((l) => l.startsWith(`# TYPE ${family}`));
      const valueIdx = lines.findIndex((l) => l.startsWith(`${family}{`) || l === `${family} 0`);

      expect(helpIdx).toBeGreaterThanOrEqual(0);
      expect(typeIdx).toBeGreaterThan(helpIdx);
      if (valueIdx >= 0) {
        expect(valueIdx).toBeGreaterThan(typeIdx);
      }
    }
  });

  it("has no duplicate metric families", () => {
    const tasks: ScheduledTask[] = [
      makeTask({ name: "a", schedule: "* * * * *", source: "crontab", nextRun: new Date("2025-06-15T11:00:00Z") }),
      makeTask({ name: "b", schedule: "* * * * *", source: "crontab", nextRun: new Date("2025-06-15T12:00:00Z") }),
    ];
    const output = toPrometheus({
      tasks,
      scannerResults: [
        { scanner: "crontab", tasks, durationMs: 10 },
      ],
    });

    const lines = output.split("\n");
    const helpLines = lines.filter((l) => l.startsWith("# HELP"));
    const typeLines = lines.filter((l) => l.startsWith("# TYPE"));

    // Each metric family should appear exactly once
    const helpFamilies = helpLines.map((l) => l.split(" ")[2]);
    const typeFamilies = typeLines.map((l) => l.split(" ")[2]);
    expect(new Set(helpFamilies).size).toBe(helpFamilies.length);
    expect(new Set(typeFamilies).size).toBe(typeFamilies.length);
  });

  it("rounds next_run_seconds to integers", () => {
    // 1500ms from now => 2 seconds rounded
    const nextRun = new Date(NOW.getTime() + 1500);
    const task = makeTask({
      name: "soon",
      schedule: "* * * * *",
      source: "crontab",
      nextRun,
    });
    const output = toPrometheus({ tasks: [task] });

    // Math.round(1500 / 1000) = 2
    expect(output).toContain('schedex_next_run_seconds{job="soon",scanner="crontab"} 2');
  });

  it("handles negative next_run_seconds for overdue tasks", () => {
    const pastRun = new Date(NOW.getTime() - 60000); // 60s ago
    const task = makeTask({
      name: "overdue",
      schedule: "* * * * *",
      source: "crontab",
      nextRun: pastRun,
    });
    const output = toPrometheus({ tasks: [task] });
    expect(output).toContain('schedex_next_run_seconds{job="overdue",scanner="crontab"} -60');
  });

  it("includes scanners with zero tasks when scannerResults has them", () => {
    const task = makeTask({ name: "job", schedule: "* * * * *", source: "crontab" });
    const output = toPrometheus({
      tasks: [task],
      scannerResults: [
        { scanner: "crontab", tasks: [task], durationMs: 10 },
        { scanner: "kubernetes", tasks: [], durationMs: 5 },
      ],
    });

    expect(output).toContain('schedex_jobs_total{scanner="crontab"} 1');
    expect(output).toContain('schedex_jobs_total{scanner="kubernetes"} 0');
  });

  it("ends output with a newline", () => {
    const output = toPrometheus({ tasks: [] });
    expect(output.endsWith("\n")).toBe(true);
  });
});
