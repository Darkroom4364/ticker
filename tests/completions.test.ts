import { describe, it, expect } from "vitest";
import { generateCompletions, type Shell } from "../src/completions.js";

describe("generateCompletions", () => {
  const subcommands = ["scan", "watch", "completions"];
  const formatValues = ["table", "json", "yaml"];
  const scannerNames = [
    "crontab",
    "systemd",
    "kubernetes",
    "eventbridge",
    "github-actions",
    "vercel",
    "cloudflare",
    "docker-cron",
  ];

  describe("bash", () => {
    const output = generateCompletions("bash");

    it("is a non-empty string", () => {
      expect(typeof output).toBe("string");
      expect(output.length).toBeGreaterThan(0);
    });

    it("contains complete -F _schedex schedex", () => {
      expect(output).toContain("complete -F _schedex schedex");
    });

    it("contains all subcommands", () => {
      for (const cmd of subcommands) {
        expect(output).toContain(cmd);
      }
    });

    it("contains format values", () => {
      for (const fmt of formatValues) {
        expect(output).toContain(fmt);
      }
    });

    it("contains scanner names", () => {
      for (const name of scannerNames) {
        expect(output).toContain(name);
      }
    });
  });

  describe("zsh", () => {
    const output = generateCompletions("zsh");

    it("is a non-empty string", () => {
      expect(typeof output).toBe("string");
      expect(output.length).toBeGreaterThan(0);
    });

    it("contains #compdef schedex", () => {
      expect(output).toContain("#compdef schedex");
    });

    it("contains all subcommands", () => {
      for (const cmd of subcommands) {
        expect(output).toContain(cmd);
      }
    });

    it("contains format values", () => {
      for (const fmt of formatValues) {
        expect(output).toContain(fmt);
      }
    });

    it("contains scanner names", () => {
      for (const name of scannerNames) {
        expect(output).toContain(name);
      }
    });
  });

  describe("fish", () => {
    const output = generateCompletions("fish");

    it("is a non-empty string", () => {
      expect(typeof output).toBe("string");
      expect(output.length).toBeGreaterThan(0);
    });

    it("contains complete -c schedex", () => {
      expect(output).toContain("complete -c schedex");
    });

    it("contains all subcommands", () => {
      for (const cmd of subcommands) {
        expect(output).toContain(cmd);
      }
    });

    it("contains format values", () => {
      for (const fmt of formatValues) {
        expect(output).toContain(fmt);
      }
    });

    it("contains scanner names", () => {
      for (const name of scannerNames) {
        expect(output).toContain(name);
      }
    });
  });

  describe("invalid shell", () => {
    it("throws an error for unsupported shell", () => {
      expect(() => generateCompletions("powershell" as Shell)).toThrow(
        /Unsupported shell/
      );
    });
  });
});
