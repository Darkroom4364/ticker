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

  it("check outputs healthy in isolated env", () => {
    const { stdout, exitCode } = run("check");
    expect(stdout.toLowerCase()).toContain("healthy");
    expect(exitCode).toBe(0);
  });

  it("check --help documents --scanners and --verbose", () => {
    const { stdout } = run("check", "--help");
    expect(stdout).toContain("--scanners");
    expect(stdout).toContain("--verbose");
  });

  it("export produces Prometheus metrics", () => {
    const { stdout, exitCode } = run("export");
    expect(stdout).toContain("schedex_jobs_total");
    expect(stdout).toContain("# HELP");
    expect(stdout).toContain("# TYPE");
    expect(exitCode).toBe(0);
  });

  it("export --help documents --scanners and --verbose", () => {
    const { stdout } = run("export", "--help");
    expect(stdout).toContain("--scanners");
    expect(stdout).toContain("--verbose");
  });

  it("completions bash produces bash completions", () => {
    const { stdout, exitCode } = run("completions", "bash");
    expect(stdout).toContain("_schedex");
    expect(stdout).toContain("compgen");
    expect(exitCode).toBe(0);
  });

  it("completions zsh produces zsh completions", () => {
    const { stdout, exitCode } = run("completions", "zsh");
    expect(stdout).toContain("#compdef schedex");
    expect(exitCode).toBe(0);
  });

  it("completions fish produces fish completions", () => {
    const { stdout, exitCode } = run("completions", "fish");
    expect(stdout).toContain("complete -c schedex");
    expect(exitCode).toBe(0);
  });

  it("completions powershell exits with error", () => {
    const { exitCode, stderr } = run("completions", "powershell");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid shell");
  });

  it("watch --help documents --interval, --format, --scanners, --verbose", () => {
    const { stdout } = run("watch", "--help");
    expect(stdout).toContain("--interval");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--scanners");
    expect(stdout).toContain("--verbose");
  });
});

describe("CLI edge cases", () => {
  it("unknown subcommand shows help or error", () => {
    const { stdout, stderr, exitCode } = run("notacommand");
    // Commander prints an error for unknown commands
    expect(stderr).toContain("notacommand");
    expect(exitCode).toBe(1);
  });

  it("scan --format with empty string errors", () => {
    const { exitCode, stderr } = run("scan", "--format", "");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid format");
  });

  it("scan --scanners with empty string still succeeds (no scanners match)", () => {
    const { exitCode } = run("scan", "--scanners", "", "--format", "json");
    // Empty string split by comma yields [""] which matches no scanners
    expect(exitCode).toBe(0);
  });

  it("last --format flag wins when multiple are given", () => {
    // Commander takes the last value for repeated options
    const { stdout, exitCode } = run(
      "scan",
      "--format",
      "json",
      "--format",
      "yaml",
    );
    expect(exitCode).toBe(0);
    // yaml output for empty array
    expect(stdout.trim()).toBe("[]");
  });

  it("--help combined with scan and other flags still shows help", () => {
    const { stdout, exitCode } = run(
      "scan",
      "--format",
      "json",
      "--verbose",
      "--help",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--scanners");
  });

  it("--version flag prints version", () => {
    const { stdout, exitCode } = run("--version");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("very long argument value for --scanners", () => {
    const longValue = "a".repeat(10000);
    const { exitCode } = run("scan", "--scanners", longValue, "--format", "json");
    // Should not crash — no scanner matches, exit 0
    expect(exitCode).toBe(0);
  });

  it("special characters in --scanners argument", () => {
    const { exitCode } = run(
      "scan",
      "--scanners",
      "foo;bar,baz'qux\"quux",
      "--format",
      "json",
    );
    // Should not crash
    expect(exitCode).toBe(0);
  });

  it("backslashes in argument values", () => {
    const { exitCode } = run(
      "scan",
      "--scanners",
      "foo\\bar\\baz",
      "--format",
      "json",
    );
    expect(exitCode).toBe(0);
  });

  it("--config pointing to nonexistent file errors", () => {
    const { exitCode, stderr } = run(
      "scan",
      "--config",
      "/tmp/schedex-nonexistent-config-12345.yml",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Config file not found");
  });

  it("completions with no shell argument errors", () => {
    const { exitCode, stderr } = run("completions");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("missing required argument");
  });

  it("scan with unknown flag errors", () => {
    const { exitCode, stderr } = run("scan", "--nonexistent-flag");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("unknown option");
  });
});
