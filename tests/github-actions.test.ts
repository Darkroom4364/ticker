import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import type { ScanOptions } from "../src/types.js";
import { GitHubActionsScanner } from "../src/scanners/github-actions.js";

// Fixtures simulate a repo with .github/workflows/
// We point the scanner at tests/fixtures/github-workflows by constructing
// a fake cwd such that cwd/.github/workflows = tests/fixtures/github-workflows
const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

// The scanner looks for <cwd>/.github/workflows — our fixture layout is
// tests/fixtures/github-workflows, so set cwd to tests/fixtures and rename
// the fixtures dir to .github/workflows? No — we'll construct the scanner
// with a cwd where .github/workflows points to our fixtures.
// Easier: the scanner takes cwd in constructor, so we create a "fake root"
// that has .github/workflows → our fixtures.

// Actually, let's just use the real fixture path by making a symlink-style
// approach. The scanner resolves join(cwd, '.github', 'workflows').
// So if cwd = tests/fixtures/github-repo, and we have
// tests/fixtures/github-repo/.github/workflows/*.yml, it works.

const FAKE_REPO = join(FIXTURES_DIR, "github-repo");

import { mkdirSync, cpSync, rmSync, existsSync } from "node:fs";

// Build the fake repo structure before tests
const workflowsDest = join(FAKE_REPO, ".github", "workflows");

function setupFixtures(): void {
  if (existsSync(FAKE_REPO)) rmSync(FAKE_REPO, { recursive: true });
  mkdirSync(workflowsDest, { recursive: true });
  cpSync(
    join(FIXTURES_DIR, "github-workflows"),
    workflowsDest,
    { recursive: true }
  );
}

setupFixtures();

const defaultOptions: ScanOptions = {};

describe("GitHubActionsScanner", () => {
  let scanner: GitHubActionsScanner;

  beforeEach(() => {
    scanner = new GitHubActionsScanner(FAKE_REPO);
  });

  describe("name", () => {
    it("should be 'github-actions'", () => {
      expect(scanner.name).toBe("github-actions");
    });
  });

  describe("isAvailable", () => {
    it("returns true when .github/workflows exists", async () => {
      expect(await scanner.isAvailable()).toBe(true);
    });

    it("returns false when .github/workflows does not exist", async () => {
      const noRepoScanner = new GitHubActionsScanner("/nonexistent/path");
      expect(await noRepoScanner.isAvailable()).toBe(false);
    });
  });

  describe("scan", () => {
    it("parses a workflow with a schedule trigger", async () => {
      const tasks = await scanner.scan(defaultOptions);
      const deploy = tasks.find((t) => t.name === "Daily Deploy");

      expect(deploy).toBeDefined();
      expect(deploy!.schedule).toBe("0 2 * * *");
      expect(deploy!.source).toBe("github-actions");
      expect(deploy!.nextRun).toBeInstanceOf(Date);
      expect(deploy!.interval).toBe("Every day at 2 AM");
      expect(deploy!.metadata?.workflowFile).toBe("deploy.yml");
      expect(deploy!.metadata?.workflowName).toBe("Daily Deploy");
      expect(deploy!.metadata?.jobs).toBe("deploy");
    });

    it("handles workflows with multiple schedule entries", async () => {
      const tasks = await scanner.scan(defaultOptions);
      const multiTasks = tasks.filter((t) => t.name === "Multi Schedule");

      expect(multiTasks).toHaveLength(2);
      expect(multiTasks[0].schedule).toBe("0 6 * * 1-5");
      expect(multiTasks[1].schedule).toBe("0 12 * * 0");
      expect(multiTasks[0].metadata?.jobs).toBe(
        "weekday-check, weekend-report"
      );
    });

    it("skips workflows without schedule triggers", async () => {
      const tasks = await scanner.scan(defaultOptions);
      const ci = tasks.find((t) => t.name === "CI");
      expect(ci).toBeUndefined();
    });

    it("skips invalid YAML files gracefully", async () => {
      // Should not throw — invalid.yml should be silently skipped
      const tasks = await scanner.scan(defaultOptions);
      const invalid = tasks.find(
        (t) => t.metadata?.workflowFile === "invalid.yml"
      );
      expect(invalid).toBeUndefined();
    });

    it("uses filename as name when workflow has no name field", async () => {
      const tasks = await scanner.scan(defaultOptions);
      const unnamed = tasks.find(
        (t) => t.metadata?.workflowFile === "unnamed.yml"
      );

      expect(unnamed).toBeDefined();
      expect(unnamed!.name).toBe("unnamed.yml");
      expect(unnamed!.schedule).toBe("*/30 * * * *");
      expect(unnamed!.interval).toBe("Every 30 minutes");
    });

    it("returns empty array when .github/workflows does not exist", async () => {
      const noRepoScanner = new GitHubActionsScanner("/nonexistent/path");
      const tasks = await noRepoScanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("sets source to 'github-actions' for all tasks", async () => {
      const tasks = await scanner.scan(defaultOptions);
      for (const task of tasks) {
        expect(task.source).toBe("github-actions");
      }
    });

    it("includes all scheduled workflows", async () => {
      const tasks = await scanner.scan(defaultOptions);
      // deploy.yml (1 schedule) + multi-schedule.yaml (2 schedules) + unnamed.yml (1 schedule)
      // no-schedule.yml and invalid.yml should be skipped
      expect(tasks).toHaveLength(4);
    });
  });
});
