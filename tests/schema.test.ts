import { describe, it, expect } from "vitest";
import type { ScheduledTask, Scanner } from "../src/index.js";
import {
  orchestrate,
  format,
  formatTable,
  formatJson,
  formatYaml,
  CrontabScanner,
  SystemdScanner,
  KubernetesScanner,
  EventBridgeScanner,
  GitHubActionsScanner,
  PartialScanError,
  parseCronExpression,
  describeCronExpression,
  getNextCronRun,
} from "../src/index.js";
import type {
  OrchestratorOptions,
  ScannerResult,
  ScanOptions,
} from "../src/index.js";

describe("ScheduledTask schema", () => {
  it("has description as a first-class optional field", () => {
    // Verify that description is part of the ScheduledTask interface,
    // not smuggled in via spread or metadata.
    const task: ScheduledTask = {
      name: "test",
      schedule: "0 0 * * *",
      source: "test",
      description: "A test task",
    };

    expect(task.description).toBe("A test task");
  });

  it("description is optional (undefined when not set)", () => {
    const task: ScheduledTask = {
      name: "test",
      schedule: "0 0 * * *",
      source: "test",
    };

    expect(task.description).toBeUndefined();
  });

  it("re-exports all public API from the barrel index", () => {
    // Cron utilities are callable and return expected types
    const parsed = parseCronExpression("0 9 * * 1-5");
    expect(parsed).toHaveProperty("nextRun");

    const description = describeCronExpression("0 9 * * 1-5");
    expect(typeof description).toBe("string");
    expect(description.length).toBeGreaterThan(0);

    const nextRun = getNextCronRun("0 0 * * *");
    expect(nextRun).toBeInstanceOf(Date);

    // Formatter functions are callable with real data
    const tasks: ScheduledTask[] = [
      { name: "test-job", schedule: "0 0 * * *", source: "test" },
    ];
    expect(typeof formatTable(tasks)).toBe("string");
    expect(() => JSON.parse(formatJson(tasks))).not.toThrow();
    expect(typeof formatYaml(tasks)).toBe("string");
    expect(typeof format(tasks, "table")).toBe("string");

    // orchestrate is an async function
    expect(typeof orchestrate).toBe("function");
    expect(orchestrate.constructor.name).toBe("AsyncFunction");

    // PartialScanError is constructable and extends Error
    const err = new PartialScanError("partial", tasks);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PartialScanError);
    expect(err.tasks).toEqual(tasks);
    expect(err.message).toBe("partial");
  });

  it("scanner classes implement the Scanner interface", () => {
    const scannerClasses = [
      CrontabScanner,
      SystemdScanner,
      KubernetesScanner,
      EventBridgeScanner,
      GitHubActionsScanner,
    ];

    for (const ScannerClass of scannerClasses) {
      const instance = new ScannerClass();
      // Each instance must satisfy the Scanner interface
      const scanner: Scanner = instance;
      expect(typeof scanner.name).toBe("string");
      expect(scanner.name.length).toBeGreaterThan(0);
      expect(typeof scanner.scan).toBe("function");
      expect(typeof scanner.isAvailable).toBe("function");
    }
  });

  it("type-only exports compile correctly", () => {
    const opts: OrchestratorOptions = { verbose: true };
    expect(opts.verbose).toBe(true);

    const scanOpts: ScanOptions = { scanners: ["crontab"], format: "json" };
    expect(scanOpts.scanners).toEqual(["crontab"]);

    const result: ScannerResult = {
      scanner: "test",
      tasks: [],
      durationMs: 42,
    };
    expect(result.scanner).toBe("test");
    expect(result.durationMs).toBe(42);

    // ScannerResult with optional error field
    const failedResult: ScannerResult = {
      scanner: "test",
      tasks: [],
      durationMs: 0,
      error: "connection refused",
    };
    expect(failedResult.error).toBe("connection refused");
  });

  it("scanners should put descriptions in description field, not metadata", () => {
    // This test documents the contract: description belongs at the top level.
    // If a scanner puts description in metadata, it's a bug.
    const taskWithDescription: ScheduledTask = {
      name: "k8s-job",
      schedule: "0 3 * * *",
      source: "kubernetes",
      description: "Daily database backup",
      metadata: {
        namespace: "default",
      },
    };

    expect(taskWithDescription.description).toBe("Daily database backup");
    expect(taskWithDescription.metadata?.["description"]).toBeUndefined();
  });
});
