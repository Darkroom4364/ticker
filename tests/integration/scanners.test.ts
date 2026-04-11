import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import type { ScanOptions, ScheduledTask } from "../../src/types.js";
import { GitHubActionsScanner } from "../../src/scanners/github-actions.js";

/**
 * Integration tests that exercise scanners against real local fixture data.
 *
 * Note: VercelScanner, CloudflareScanner, and DockerCronScanner do not exist
 * in the current codebase. Tests cover the available scanners with real fixture
 * files on disk.
 */

const FIXTURES_DIR = join(import.meta.dirname, "..", "fixtures");
const INTEGRATION_FIXTURES = join(FIXTURES_DIR, "integration");
const defaultOptions: ScanOptions = {};

// ── Fixture setup ──────────────────────────────────────────────────────

function createGitHubActionsFixtures(): string {
  const repoDir = join(INTEGRATION_FIXTURES, "gh-actions-repo");
  const workflowsDir = join(repoDir, ".github", "workflows");

  if (existsSync(repoDir)) rmSync(repoDir, { recursive: true });
  mkdirSync(workflowsDir, { recursive: true });

  writeFileSync(
    join(workflowsDir, "nightly.yml"),
    `name: Nightly Build
on:
  schedule:
    - cron: '30 3 * * *'
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run build
`
  );

  writeFileSync(
    join(workflowsDir, "weekly-report.yaml"),
    `name: Weekly Report
on:
  schedule:
    - cron: '0 9 * * 1'
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - run: echo "generating report"
`
  );

  writeFileSync(
    join(workflowsDir, "ci-only.yml"),
    `name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`
  );

  return repoDir;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("Integration: GitHubActionsScanner with real fixtures", () => {
  let repoDir: string;
  let scanner: GitHubActionsScanner;

  beforeAll(() => {
    repoDir = createGitHubActionsFixtures();
    scanner = new GitHubActionsScanner(repoDir);
  });

  it("isAvailable() returns true when pointed at fixtures", async () => {
    expect(await scanner.isAvailable()).toBe(true);
  });

  it("isAvailable() returns false for a non-existent directory", async () => {
    const missing = new GitHubActionsScanner("/tmp/no-such-repo-xyz");
    expect(await missing.isAvailable()).toBe(false);
  });

  it("scan() returns correctly typed ScheduledTask[]", async () => {
    const tasks = await scanner.scan(defaultOptions);
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThan(0);

    for (const task of tasks) {
      // Verify structural typing
      expect(typeof task.name).toBe("string");
      expect(typeof task.schedule).toBe("string");
      expect(typeof task.source).toBe("string");
      expect(task.source).toBe("github-actions");
    }
  });

  it("scan() finds the nightly build schedule", async () => {
    const tasks = await scanner.scan(defaultOptions);
    const nightly = tasks.find((t) => t.name === "Nightly Build");

    expect(nightly).toBeDefined();
    expect(nightly!.schedule).toBe("30 3 * * *");
    expect(nightly!.interval).toBe("Every day at 3:30 AM");
    expect(nightly!.metadata?.workflowFile).toBe("nightly.yml");
  });

  it("scan() finds the weekly report schedule", async () => {
    const tasks = await scanner.scan(defaultOptions);
    const weekly = tasks.find((t) => t.name === "Weekly Report");

    expect(weekly).toBeDefined();
    expect(weekly!.schedule).toBe("0 9 * * 1");
    expect(weekly!.metadata?.workflowFile).toBe("weekly-report.yaml");
  });

  it("scan() skips workflows without schedule triggers", async () => {
    const tasks = await scanner.scan(defaultOptions);
    const ci = tasks.find((t) => t.name === "CI");
    expect(ci).toBeUndefined();
  });

  it("scan() returns only scheduled workflows (correct count)", async () => {
    const tasks = await scanner.scan(defaultOptions);
    // nightly.yml (1) + weekly-report.yaml (1) = 2; ci-only.yml has no schedule
    expect(tasks).toHaveLength(2);
  });

  it("tasks have valid nextRun dates (instanceof Date, in the future)", async () => {
    const tasks = await scanner.scan(defaultOptions);
    const now = new Date();

    for (const task of tasks) {
      expect(task.nextRun).toBeInstanceOf(Date);
      expect((task.nextRun as Date).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("tasks include interval descriptions", async () => {
    const tasks = await scanner.scan(defaultOptions);
    for (const task of tasks) {
      expect(typeof task.interval).toBe("string");
      expect((task.interval as string).length).toBeGreaterThan(0);
    }
  });

  it("tasks include metadata with workflowFile", async () => {
    const tasks = await scanner.scan(defaultOptions);
    for (const task of tasks) {
      expect(task.metadata).toBeDefined();
      expect(typeof task.metadata!.workflowFile).toBe("string");
      expect(
        task.metadata!.workflowFile.endsWith(".yml") ||
          task.metadata!.workflowFile.endsWith(".yaml")
      ).toBe(true);
    }
  });
});

describe("Integration: Scanner with multiple schedule entries", () => {
  let scanner: GitHubActionsScanner;

  beforeAll(() => {
    const repoDir = join(INTEGRATION_FIXTURES, "gh-multi-repo");
    const workflowsDir = join(repoDir, ".github", "workflows");

    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true });
    mkdirSync(workflowsDir, { recursive: true });

    writeFileSync(
      join(workflowsDir, "multi.yml"),
      `name: Multi Trigger
on:
  schedule:
    - cron: '0 0 * * *'
    - cron: '0 12 * * *'
    - cron: '0 18 * * 5'
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - run: echo "hello"
`
    );

    scanner = new GitHubActionsScanner(repoDir);
  });

  it("produces one task per cron entry", async () => {
    const tasks = await scanner.scan(defaultOptions);
    expect(tasks).toHaveLength(3);
  });

  it("each task has a valid future nextRun", async () => {
    const tasks = await scanner.scan(defaultOptions);
    const now = new Date();

    for (const task of tasks) {
      expect(task.nextRun).toBeInstanceOf(Date);
      expect((task.nextRun as Date).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("all tasks share the same workflow name", async () => {
    const tasks = await scanner.scan(defaultOptions);
    for (const task of tasks) {
      expect(task.name).toBe("Multi Trigger");
    }
  });
});

describe("Integration: Scanner with edge-case YAML", () => {
  let scanner: GitHubActionsScanner;

  beforeAll(() => {
    const repoDir = join(INTEGRATION_FIXTURES, "gh-edge-repo");
    const workflowsDir = join(repoDir, ".github", "workflows");

    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true });
    mkdirSync(workflowsDir, { recursive: true });

    // Empty YAML file
    writeFileSync(join(workflowsDir, "empty.yml"), "");

    // YAML with only comments
    writeFileSync(
      join(workflowsDir, "comments-only.yml"),
      "# This file is intentionally empty\n# No workflow here\n"
    );

    // Valid workflow with unusual but correct cron
    writeFileSync(
      join(workflowsDir, "unusual-cron.yml"),
      `name: Unusual Cron
on:
  schedule:
    - cron: '*/10 2-4 * * *'
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - run: echo "tick"
`
    );

    scanner = new GitHubActionsScanner(repoDir);
  });

  it("gracefully handles empty and comment-only YAML files", async () => {
    const tasks = await scanner.scan(defaultOptions);
    // Only the unusual-cron workflow should produce a task
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("Unusual Cron");
  });

  it("parses step+range cron expressions correctly", async () => {
    const tasks = await scanner.scan(defaultOptions);
    const task = tasks[0];
    expect(task.schedule).toBe("*/10 2-4 * * *");
    expect(task.nextRun).toBeInstanceOf(Date);
    expect((task.nextRun as Date).getTime()).toBeGreaterThan(Date.now());
  });
});
