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

  it("scan command prints placeholder output", () => {
    const output = run("scan");
    expect(output).toContain("Scanning for scheduled jobs");
    expect(output).toContain("Format: table");
  });

  it("scan command accepts --format flag", () => {
    const output = run("scan", "--format", "json");
    expect(output).toContain("Format: json");
  });
});
