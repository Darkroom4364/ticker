import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const CLI_PATH = resolve(import.meta.dirname, "../dist/cli.js");

function run(...args: string[]): string {
  return execFileSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 5000,
  });
}

describe("ticker CLI", () => {
  it("prints version with --version", () => {
    const output = run("--version");
    expect(output.trim()).toBe("0.1.0");
  });

  it("prints help with --help", () => {
    const output = run("--help");
    expect(output).toContain("ticker");
    expect(output).toContain("scan");
  });

  it("scan command produces table output by default", () => {
    const output = run("scan");
    // With no scanners available in CI, should show empty results message
    expect(output).toContain("No scheduled tasks found");
  });

  it("scan command accepts --format json flag", () => {
    const output = run("scan", "--format", "json");
    // Should produce valid JSON (empty array when no scanners available)
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
