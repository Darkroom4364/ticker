import { describe, it, expect } from "vitest";
import { join } from "node:path";
import type { ScanOptions } from "../src/types.js";
import { CloudflareScanner } from "../src/scanners/cloudflare.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");
const defaultOptions: ScanOptions = {};

describe("CloudflareScanner", () => {
  describe("name", () => {
    it("should be 'cloudflare'", () => {
      const scanner = new CloudflareScanner();
      expect(scanner.name).toBe("cloudflare");
    });
  });

  describe("isAvailable", () => {
    it("returns true when wrangler.toml exists", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-toml"));
      expect(await scanner.isAvailable()).toBe(true);
    });

    it("returns true when wrangler.json exists", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-json"));
      expect(await scanner.isAvailable()).toBe(true);
    });

    it("returns false when neither file exists", async () => {
      const scanner = new CloudflareScanner("/nonexistent/path");
      expect(await scanner.isAvailable()).toBe(false);
    });
  });

  describe("scan", () => {
    it("parses cron triggers from wrangler.toml", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-toml"));
      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(2);

      expect(tasks[0].schedule).toBe("0 * * * *");
      expect(tasks[0].source).toBe("cloudflare");
      expect(tasks[0].interval).toBe("Every hour");
      expect(tasks[0].nextRun).toBeInstanceOf(Date);
      expect(tasks[0].metadata?.configFile).toBe("wrangler.toml");

      expect(tasks[1].schedule).toBe("30 8 * * 1-5");
      expect(tasks[1].interval).toBe("Every Monday, Tuesday, Wednesday, Thursday, Friday at 8:30 AM");
    });

    it("parses cron triggers from wrangler.json", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-json"));
      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(2);

      expect(tasks[0].schedule).toBe("0 12 * * *");
      expect(tasks[0].source).toBe("cloudflare");
      expect(tasks[0].interval).toBe("Every day at 12 PM");
      expect(tasks[0].metadata?.configFile).toBe("wrangler.json");

      expect(tasks[1].schedule).toBe("*/15 * * * *");
      expect(tasks[1].interval).toBe("Every 15 minutes");
    });

    it("returns empty array for malformed config", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-malformed"));
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array when no crons triggers exist", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-no-crons"));
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array when no config file exists", async () => {
      const scanner = new CloudflareScanner("/nonexistent/path");
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("sets source to 'cloudflare' for all tasks", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-toml"));
      const tasks = await scanner.scan(defaultOptions);
      for (const task of tasks) {
        expect(task.source).toBe("cloudflare");
      }
    });
  });
});
