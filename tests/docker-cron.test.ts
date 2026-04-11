import { describe, it, expect } from "vitest";
import { join } from "node:path";
import type { ScanOptions } from "../src/types.js";
import { DockerCronScanner } from "../src/scanners/docker-cron.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");
const defaultOptions: ScanOptions = {};

describe("DockerCronScanner", () => {
  describe("name", () => {
    it("should be 'docker-cron'", () => {
      const scanner = new DockerCronScanner();
      expect(scanner.name).toBe("docker-cron");
    });
  });

  describe("isAvailable", () => {
    it("returns true when a crontab file exists", async () => {
      const scanner = new DockerCronScanner(join(FIXTURES_DIR, "docker-cron-project"));
      expect(await scanner.isAvailable()).toBe(true);
    });

    it("returns false when no crontab files exist", async () => {
      const scanner = new DockerCronScanner("/nonexistent/path");
      expect(await scanner.isAvailable()).toBe(false);
    });
  });

  describe("scan", () => {
    it("parses crontab entries from project crontab file", async () => {
      const scanner = new DockerCronScanner(join(FIXTURES_DIR, "docker-cron-project"));
      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(2);

      const healthCheck = tasks.find((t) => t.name === "health-check");
      expect(healthCheck).toBeDefined();
      expect(healthCheck!.schedule).toBe("*/5 * * * *");
      expect(healthCheck!.source).toBe("docker-cron");
      expect(healthCheck!.command).toBe("/usr/local/bin/health-check");
      expect(healthCheck!.interval).toBe("Every 5 minutes");
      expect(healthCheck!.nextRun).toBeInstanceOf(Date);
      expect(healthCheck!.metadata?.file).toBe("crontab");

      const backup = tasks.find((t) => t.name === "backup.sh");
      expect(backup).toBeDefined();
      expect(backup!.schedule).toBe("0 2 * * *");
      expect(backup!.command).toBe("/app/scripts/backup.sh");
      expect(backup!.interval).toBe("Every day at 2 AM");
    });

    it("returns empty array when crontab has no jobs", async () => {
      const scanner = new DockerCronScanner(join(FIXTURES_DIR, "docker-cron-empty"));
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array when no crontab files exist", async () => {
      const scanner = new DockerCronScanner("/nonexistent/path");
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("skips comments and environment variable lines", async () => {
      const scanner = new DockerCronScanner(join(FIXTURES_DIR, "docker-cron-project"));
      const tasks = await scanner.scan(defaultOptions);
      // Should only have the 2 actual cron jobs, not the comment or SHELL= line
      expect(tasks).toHaveLength(2);
      for (const task of tasks) {
        expect(task.name).not.toBe("#");
        expect(task.name).not.toBe("SHELL");
      }
    });

    it("sets source to 'docker-cron' for all tasks", async () => {
      const scanner = new DockerCronScanner(join(FIXTURES_DIR, "docker-cron-project"));
      const tasks = await scanner.scan(defaultOptions);
      for (const task of tasks) {
        expect(task.source).toBe("docker-cron");
      }
    });
  });
});
