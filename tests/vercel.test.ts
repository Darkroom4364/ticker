import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import type { ScanOptions } from "../src/types.js";
import { VercelScanner } from "../src/scanners/vercel.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");
const defaultOptions: ScanOptions = {};

describe("VercelScanner", () => {
  describe("name", () => {
    it("should be 'vercel'", () => {
      const scanner = new VercelScanner();
      expect(scanner.name).toBe("vercel");
    });
  });

  describe("isAvailable", () => {
    it("returns true when vercel.json exists", async () => {
      const scanner = new VercelScanner(join(FIXTURES_DIR, "vercel-project"));
      expect(await scanner.isAvailable()).toBe(true);
    });

    it("returns false when vercel.json does not exist", async () => {
      const scanner = new VercelScanner("/nonexistent/path");
      expect(await scanner.isAvailable()).toBe(false);
    });
  });

  describe("scan", () => {
    it("parses vercel.json with cron entries", async () => {
      const scanner = new VercelScanner(join(FIXTURES_DIR, "vercel-project"));
      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(2);

      const daily = tasks.find((t) => t.name === "/api/cron");
      expect(daily).toBeDefined();
      expect(daily!.schedule).toBe("0 5 * * *");
      expect(daily!.source).toBe("vercel");
      expect(daily!.nextRun).toBeInstanceOf(Date);
      expect(daily!.interval).toBe("Every day at 5 AM");
      expect(daily!.metadata?.path).toBe("/api/cron");

      const weekly = tasks.find((t) => t.name === "/api/weekly-report");
      expect(weekly).toBeDefined();
      expect(weekly!.schedule).toBe("0 9 * * 1");
      expect(weekly!.source).toBe("vercel");
      expect(weekly!.interval).toBe("Every Monday at 9 AM");
    });

    it("returns empty array when crons array is empty", async () => {
      const scanner = new VercelScanner(join(FIXTURES_DIR, "vercel-empty"));
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array for malformed JSON", async () => {
      const scanner = new VercelScanner(join(FIXTURES_DIR, "vercel-malformed"));
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array when no crons field exists", async () => {
      const scanner = new VercelScanner(join(FIXTURES_DIR, "vercel-no-crons"));
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array when vercel.json does not exist", async () => {
      const scanner = new VercelScanner("/nonexistent/path");
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("sets source to 'vercel' for all tasks", async () => {
      const scanner = new VercelScanner(join(FIXTURES_DIR, "vercel-project"));
      const tasks = await scanner.scan(defaultOptions);
      for (const task of tasks) {
        expect(task.source).toBe("vercel");
      }
    });
  });
});
