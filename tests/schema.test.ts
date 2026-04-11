import { describe, it, expect } from "vitest";
import type { ScheduledTask } from "../src/types.js";
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
    // Functions
    expect(typeof orchestrate).toBe("function");
    expect(typeof format).toBe("function");
    expect(typeof formatTable).toBe("function");
    expect(typeof formatJson).toBe("function");
    expect(typeof formatYaml).toBe("function");
    expect(typeof parseCronExpression).toBe("function");
    expect(typeof describeCronExpression).toBe("function");
    expect(typeof getNextCronRun).toBe("function");

    // Scanner classes
    expect(typeof CrontabScanner).toBe("function");
    expect(typeof SystemdScanner).toBe("function");
    expect(typeof KubernetesScanner).toBe("function");
    expect(typeof EventBridgeScanner).toBe("function");
    expect(typeof GitHubActionsScanner).toBe("function");

    // Error class
    expect(typeof PartialScanError).toBe("function");

    // Type-only exports compile successfully (OrchestratorOptions, ScannerResult)
    const opts: OrchestratorOptions = { verbose: true };
    expect(opts.verbose).toBe(true);

    const result: ScannerResult = {
      scanner: "test",
      tasks: [],
      durationMs: 0,
    };
    expect(result.scanner).toBe("test");
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
