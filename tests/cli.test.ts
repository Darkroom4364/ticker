import { describe, it, expect } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { dirname, resolve } from "node:path";

// Build fresh before tests to avoid stale dist
execSync("npm run build", {
  cwd: resolve(import.meta.dirname, ".."),
  stdio: "pipe",
});

const CLI_PATH = resolve(import.meta.dirname, "../dist/cli.js");
const NODE_PATH = process.execPath;
// Minimal PATH: only the directory containing the node binary
const MINIMAL_PATH = dirname(NODE_PATH);

function run(
  ...args: string[]
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(NODE_PATH, [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: 10000,
      env: {
        // Isolate from ambient schedulers: strip tools like crontab,
        // systemctl, kubectl and clear cloud credentials so results
        // are deterministic regardless of the host environment.
        PATH: MINIMAL_PATH,
        HOME: "/nonexistent",
        AWS_ACCESS_KEY_ID: "",
        AWS_SECRET_ACCESS_KEY: "",
        KUBECONFIG: "/nonexistent",
        NODE_PATH: "",
      },
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error: unknown) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

describe("schedex CLI", () => {
  it("prints version with --version", () => {
    const { stdout } = run("--version");
    expect(stdout.trim()).toBe("1.0.0");
  });

  it("prints help with --help", () => {
    const { stdout } = run("--help");
    expect(stdout).toContain("schedex");
    expect(stdout).toContain("scan");
  });

  it("help documents all flags", () => {
    const { stdout } = run("scan", "--help");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--scanners");
    expect(stdout).toContain("--verbose");
  });

  it("scan produces table output by default", () => {
    const { stdout, exitCode } = run("scan");
    // In isolated env, no scanners detect anything
    expect(stdout).toContain("No scheduled tasks found");
    expect(exitCode).toBe(0);
  });

  it("scan --format json produces valid JSON", () => {
    const { stdout } = run("scan", "--format", "json");
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("scan --format yaml produces valid YAML", () => {
    const { stdout } = run("scan", "--format", "yaml");
    // Empty array in YAML is "[]" or "[]\n"
    expect(stdout.trim()).toBe("[]");
  });

  it("scan --format invalid exits with code 1 and stderr message", () => {
    const { exitCode, stderr } = run("scan", "--format", "xml");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid format");
    expect(stderr).toContain("xml");
  });

  it("scan --scanners filters to specified scanners", () => {
    const { stdout, exitCode } = run(
      "scan",
      "--scanners",
      "crontab",
      "--format",
      "json"
    );
    // Should still produce valid output (even if crontab finds nothing)
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(exitCode).toBe(0);
  });

  it("exits with code 1 when all scanners fail", () => {
    // Runs a fixture that creates a scanner which always throws,
    // then exercises the same allFailed → exit(1) logic as
    // src/cli.ts:47. We can't trigger this from the real CLI because
    // unavailable scanners are skipped (no error), not failed.
    const fixturePath = resolve(
      import.meta.dirname,
      "fixtures/all-fail-cli.mjs"
    );
    try {
      execFileSync(NODE_PATH, [fixturePath], {
        encoding: "utf-8",
        timeout: 10000,
        env: {
          PATH: MINIMAL_PATH,
          HOME: "/nonexistent",
        },
      });
      expect.fail("Should have exited with code 1");
    } catch (error: unknown) {
      const err = error as { status?: number };
      expect(err.status).toBe(1);
    }
  });

  it("exits with code 0 when no scanners match filter (empty results)", () => {
    const { exitCode } = run("scan", "--scanners", "nonexistent");
    // No scanners ran → results.length === 0 → not allFailed → exit 0
    expect(exitCode).toBe(0);
  });

  it("scan --verbose writes scanner details to stderr", () => {
    // execFileSync only captures stderr on failure, so use execSync
    // with combined output to verify verbose flag works
    try {
      const output = execSync(
        `"${NODE_PATH}" "${CLI_PATH}" scan --verbose 2>&1`,
        {
          encoding: "utf-8",
          timeout: 10000,
          env: {
            PATH: MINIMAL_PATH,
            HOME: "/nonexistent",
            AWS_ACCESS_KEY_ID: "",
            AWS_SECRET_ACCESS_KEY: "",
            KUBECONFIG: "/nonexistent",
          },
        }
      );
      // Verbose output includes scanner names with timing
      expect(output).toMatch(/\[.+\].*\d+ms/);
    } catch (error: unknown) {
      const err = error as { stdout?: string };
      expect(err.stdout ?? "").toMatch(/\[.+\].*\d+ms/);
    }
  });
});
