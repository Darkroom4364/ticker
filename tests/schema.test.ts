import { describe, it, expect } from "vitest";
import type { ScheduledTask } from "../src/types.js";

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
