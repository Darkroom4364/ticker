import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanOptions } from "../src/types.js";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

import { exec } from "node:child_process";
import { KubernetesScanner } from "../src/scanners/kubernetes.js";

const mockedExec = vi.mocked(exec);

function mockExecByCommand(handlers: Record<string, string | Error>): void {
  mockedExec.mockImplementation((cmd: unknown, callback: unknown) => {
    const command = cmd as string;
    for (const [key, value] of Object.entries(handlers)) {
      if (command.includes(key)) {
        if (value instanceof Error) {
          (callback as (err: Error) => void)(value);
        } else {
          (callback as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
            stdout: value,
            stderr: "",
          });
        }
        return undefined as ReturnType<typeof exec>;
      }
    }
    (callback as (err: Error) => void)(new Error(`Unexpected command: ${command}`));
    return undefined as ReturnType<typeof exec>;
  });
}

const CRONJOB_LIST = JSON.stringify({
  items: [
    {
      metadata: {
        name: "daily-backup",
        namespace: "production",
        annotations: { description: "Daily database backup" },
      },
      spec: {
        schedule: "0 2 * * *",
        suspend: false,
        jobTemplate: {
          spec: {
            template: {
              spec: {
                containers: [{ name: "backup", image: "myregistry/backup:latest" }],
              },
            },
          },
        },
      },
      status: {
        lastScheduleTime: "2025-01-19T02:00:00Z",
      },
    },
    {
      metadata: {
        name: "report-gen",
        namespace: "analytics",
        annotations: {},
      },
      spec: {
        schedule: "0 8 * * 1-5",
        suspend: false,
        jobTemplate: {
          spec: {
            template: {
              spec: {
                containers: [{ name: "report", image: "myregistry/reports:v2" }],
              },
            },
          },
        },
      },
      status: {},
    },
    {
      metadata: {
        name: "cleanup",
        namespace: "default",
        annotations: {},
      },
      spec: {
        schedule: "0 0 * * 0",
        suspend: true,
        jobTemplate: {
          spec: {
            template: {
              spec: {
                containers: [{ name: "clean", image: "myregistry/cleanup:v1" }],
              },
            },
          },
        },
      },
      status: {
        lastScheduleTime: "2025-01-12T00:00:00Z",
      },
    },
  ],
});

const EMPTY_CRONJOB_LIST = JSON.stringify({ items: [] });

const defaultOptions: ScanOptions = {};

describe("KubernetesScanner", () => {
  let scanner: KubernetesScanner;

  beforeEach(() => {
    vi.clearAllMocks();
    scanner = new KubernetesScanner();
  });

  describe("name", () => {
    it("should be 'kubernetes'", () => {
      expect(scanner.name).toBe("kubernetes");
    });
  });

  describe("isAvailable", () => {
    it("returns true when kubectl exists", async () => {
      mockExecByCommand({ "which kubectl": "/usr/local/bin/kubectl" });
      expect(await scanner.isAvailable()).toBe(true);
    });

    it("returns false when kubectl is not found", async () => {
      mockExecByCommand({ "which kubectl": new Error("which: no kubectl in PATH") });
      expect(await scanner.isAvailable()).toBe(false);
    });
  });

  describe("scan", () => {
    it("parses multiple CronJobs across namespaces", async () => {
      mockExecByCommand({
        "kubectl get cronjobs": CRONJOB_LIST,
        "which": "/usr/local/bin/kubectl",
      });

      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(3);

      expect(tasks[0].name).toBe("production/daily-backup");
      expect(tasks[0].schedule).toBe("0 2 * * *");
      expect(tasks[0].source).toBe("kubernetes");
      expect(tasks[0].nextRun).toBeInstanceOf(Date);
      expect(tasks[0].interval).toBe("Every day at 2 AM");
      expect(tasks[0].command).toBe("myregistry/backup:latest");
      expect(tasks[0].metadata?.namespace).toBe("production");
      expect(tasks[0].metadata?.image).toBe("myregistry/backup:latest");
      expect(tasks[0].metadata?.lastScheduleTime).toBe("2025-01-19T02:00:00Z");

      expect(tasks[1].name).toBe("analytics/report-gen");
      expect(tasks[1].schedule).toBe("0 8 * * 1-5");
      expect(tasks[1].metadata?.namespace).toBe("analytics");

      expect(tasks[2].name).toBe("default/cleanup");
      expect(tasks[2].schedule).toBe("0 0 * * 0");
    });

    it("returns empty array for empty CronJob list", async () => {
      mockExecByCommand({
        "kubectl get cronjobs": EMPTY_CRONJOB_LIST,
        "which": "/usr/local/bin/kubectl",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array when kubectl is not found", async () => {
      mockExecByCommand({
        "kubectl get cronjobs": new Error("command not found: kubectl"),
        "which": new Error("not found"),
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array when cluster is unreachable", async () => {
      mockExecByCommand({
        "kubectl get cronjobs": new Error("Unable to connect to the server: dial tcp 127.0.0.1:6443: connection refused"),
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("marks suspended CronJobs in metadata", async () => {
      mockExecByCommand({
        "kubectl get cronjobs": CRONJOB_LIST,
        "which": "/usr/local/bin/kubectl",
      });

      const tasks = await scanner.scan(defaultOptions);
      const suspended = tasks.find((t) => t.name === "default/cleanup");

      expect(suspended).toBeDefined();
      expect(suspended?.metadata?.suspended).toBe("true");
    });

    it("does not set suspended metadata for non-suspended jobs", async () => {
      mockExecByCommand({
        "kubectl get cronjobs": CRONJOB_LIST,
        "which": "/usr/local/bin/kubectl",
      });

      const tasks = await scanner.scan(defaultOptions);
      const active = tasks.find((t) => t.name === "production/daily-backup");

      expect(active?.metadata?.suspended).toBeUndefined();
    });

    it("computes nextRun and interval from cron schedule", async () => {
      mockExecByCommand({
        "kubectl get cronjobs": CRONJOB_LIST,
        "which": "/usr/local/bin/kubectl",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks[0].nextRun).toBeInstanceOf(Date);
      expect(tasks[0].interval).toBe("Every day at 2 AM");
    });

    it("handles API group list error gracefully", async () => {
      mockExecByCommand({
        "kubectl get cronjobs": new Error("couldn't get current server API group list"),
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("sets source to 'kubernetes' for all tasks", async () => {
      mockExecByCommand({
        "kubectl get cronjobs": CRONJOB_LIST,
        "which": "/usr/local/bin/kubectl",
      });

      const tasks = await scanner.scan(defaultOptions);
      for (const task of tasks) {
        expect(task.source).toBe("kubernetes");
      }
    });
  });
});
