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

  describe("edge cases", () => {
    it("returns empty array for wrangler.toml with empty crons array", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-empty-crons"));
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("still returns tasks for invalid cron expressions (unparseable schedule kept raw)", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-invalid-crons"));
      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(2);
      expect(tasks[0].schedule).toBe("not-a-cron");
      expect(tasks[0].nextRun).toBeUndefined();
      expect(tasks[0].interval).toBeUndefined();
      expect(tasks[1].schedule).toBe("also bad * *");
    });

    it("parses crons from wrangler.toml with extremely nested TOML structure", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-nested-toml"));
      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].schedule).toBe("0 6 * * *");
    });

    it("returns empty array for wrangler.json with null crons", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-json-null-crons"));
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array for wrangler.json with crons as string instead of array", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-json-string-crons"));
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("parses crons from wrangler.json with deeply nested triggers", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-json-nested-triggers"));
      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].schedule).toBe("0 3 * * *");
    });

    it("prefers wrangler.toml over wrangler.json when both present", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-both-files"));
      const tasks = await scanner.scan(defaultOptions);

      // wrangler.toml has "0 1 * * *", wrangler.json has "0 2 * * *" and "0 3 * * *"
      // Scanner tries toml first, so should get 1 task from toml
      expect(tasks).toHaveLength(1);
      expect(tasks[0].schedule).toBe("0 1 * * *");
      expect(tasks[0].metadata?.configFile).toBe("wrangler.toml");
    });

    it("returns empty array when neither file present", async () => {
      const scanner = new CloudflareScanner("/nonexistent/definitely/not/here");
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("handles wrangler.toml with BOM marker", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-bom"));
      const tasks = await scanner.scan(defaultOptions);

      // BOM may interfere with parsing if the regex doesn't account for it
      // The [triggers] section comes after the BOM so it should still be found
      expect(tasks).toHaveLength(1);
      expect(tasks[0].schedule).toBe("0 9 * * *");
    });

    it("handles very large wrangler.toml with many sections", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-large-toml"));
      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].schedule).toBe("0 22 * * *");
    });
  });

  describe("TOML parser bugs", () => {
    it("bug: escaped quotes in cron values corrupt parsed output", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-toml-escaped-quotes"));
      const tasks = await scanner.scan(defaultOptions);

      // The TOML contains: crons = ["0 * * * \"quoted\""]
      // The regex splits on the escaped quotes, so parsing is corrupted.
      // A correct parser should extract the full string including escaped quotes.
      expect(tasks).toHaveLength(1);
      expect(tasks[0].schedule).toContain("quoted");
    });

    it("bug: nested brackets in crons array cause silent truncation", async () => {
      const scanner = new CloudflareScanner(join(FIXTURES_DIR, "cloudflare-toml-nested-brackets"));
      const tasks = await scanner.scan(defaultOptions);

      // The TOML contains: crons = ["0 * * * *", [1, 2, 3], "30 8 * * 1-5"]
      // The regex [^\]] stops at the first ], so only "0 * * * *" is captured.
      // A correct parser should find both cron strings.
      expect(tasks).toHaveLength(2);
      expect(tasks[0].schedule).toBe("0 * * * *");
      expect(tasks[1].schedule).toBe("30 8 * * 1-5");
    });
  });
});
