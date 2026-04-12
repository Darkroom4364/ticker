import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, execSync } from "node:child_process";
import { loadConfig } from "../src/config.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "schedex-config-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("loads a valid YAML config", async () => {
    const configPath = join(tempDir, "config.yml");
    await writeFile(
      configPath,
      `format: json\nscanners:\n  - crontab\n  - systemd\nverbose: true\n`,
    );

    const config = await loadConfig(configPath);
    expect(config).toEqual({
      format: "json",
      scanners: ["crontab", "systemd"],
      verbose: true,
    });
  });

  it("returns null when no config file exists", async () => {
    // Override cwd to an empty temp dir so no .schedexrc.yml is found,
    // and HOME to a nonexistent dir so ~/.config/schedex/config.yml is absent
    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;
    try {
      process.chdir(tempDir);
      process.env.HOME = join(tempDir, "nonexistent-home");
      const config = await loadConfig();
      expect(config).toBeNull();
    } finally {
      process.chdir(originalCwd);
      process.env.HOME = originalHome;
    }
  });

  it("throws when explicit --config path does not exist", async () => {
    const missingPath = join(tempDir, "nonexistent.yml");
    await expect(loadConfig(missingPath)).rejects.toThrow(
      /Config file not found/,
    );
  });

  it("handles partial configs (only some fields specified)", async () => {
    const configPath = join(tempDir, "partial.yml");
    await writeFile(configPath, `format: yaml\n`);

    const config = await loadConfig(configPath);
    expect(config).toEqual({ format: "yaml" });
    expect(config!.scanners).toBeUndefined();
    expect(config!.verbose).toBeUndefined();
  });

  it("handles empty config file", async () => {
    const configPath = join(tempDir, "empty.yml");
    await writeFile(configPath, "");

    const config = await loadConfig(configPath);
    expect(config).toEqual({});
  });

  it("throws on invalid YAML", async () => {
    const configPath = join(tempDir, "bad.yml");
    await writeFile(configPath, "format: [\ninvalid yaml");

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("throws on invalid format value in config", async () => {
    const configPath = join(tempDir, "bad-format.yml");
    await writeFile(configPath, "format: xml\n");

    await expect(loadConfig(configPath)).rejects.toThrow(/Invalid format/);
  });

  it("throws when scanners is not a list", async () => {
    const configPath = join(tempDir, "bad-scanners.yml");
    await writeFile(configPath, "scanners: crontab\n");

    await expect(loadConfig(configPath)).rejects.toThrow(/expected a list/);
  });

  it("respects lookup order: cwd before home", async () => {
    // Create config in both cwd and home locations
    const cwdConfig = join(tempDir, ".schedexrc.yml");
    await writeFile(cwdConfig, "format: json\n");

    const homeConfigDir = join(tempDir, "home", ".config", "schedex");
    await mkdir(homeConfigDir, { recursive: true });
    await writeFile(join(homeConfigDir, "config.yml"), "format: yaml\n");

    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;
    try {
      process.chdir(tempDir);
      process.env.HOME = join(tempDir, "home");
      const config = await loadConfig();
      expect(config).toEqual({ format: "json" }); // cwd wins
    } finally {
      process.chdir(originalCwd);
      process.env.HOME = originalHome;
    }
  });

  it("falls back to home config when cwd has no config", async () => {
    const homeConfigDir = join(tempDir, "home", ".config", "schedex");
    await mkdir(homeConfigDir, { recursive: true });
    await writeFile(join(homeConfigDir, "config.yml"), "format: yaml\n");

    const emptyDir = join(tempDir, "empty-cwd");
    await mkdir(emptyDir, { recursive: true });

    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;
    try {
      process.chdir(emptyDir);
      process.env.HOME = join(tempDir, "home");
      const config = await loadConfig();
      expect(config).toEqual({ format: "yaml" }); // home config used
    } finally {
      process.chdir(originalCwd);
      process.env.HOME = originalHome;
    }
  });

  it("explicit --config path takes priority over cwd and home", async () => {
    const explicitConfig = join(tempDir, "explicit.yml");
    await writeFile(explicitConfig, "format: table\nverbose: true\n");

    const cwdConfig = join(tempDir, ".schedexrc.yml");
    await writeFile(cwdConfig, "format: json\n");

    const originalCwd = process.cwd();
    try {
      process.chdir(tempDir);
      const config = await loadConfig(explicitConfig);
      expect(config).toEqual({ format: "table", verbose: true });
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("loadConfig edge cases", () => {
  it("ignores unknown/extra keys in config", async () => {
    const configPath = join(tempDir, "extra-keys.yml");
    await writeFile(
      configPath,
      "format: json\nunknownKey: 42\nextra: hello\n",
    );

    const config = await loadConfig(configPath);
    // Extra keys should be silently ignored — only known fields returned
    expect(config).toEqual({ format: "json" });
    expect((config as Record<string, unknown>).unknownKey).toBeUndefined();
  });

  it("throws when scanners is a string instead of array", async () => {
    const configPath = join(tempDir, "scanners-string.yml");
    await writeFile(configPath, "scanners: crontab\n");

    await expect(loadConfig(configPath)).rejects.toThrow(/expected a list/);
  });

  it("throws on format set to empty string", async () => {
    const configPath = join(tempDir, "format-empty.yml");
    await writeFile(configPath, "format: ''\n");

    await expect(loadConfig(configPath)).rejects.toThrow(/Invalid format/);
  });

  it("coerces verbose string 'true' to boolean true via Boolean()", async () => {
    const configPath = join(tempDir, "verbose-string.yml");
    await writeFile(configPath, 'verbose: "true"\n');

    const config = await loadConfig(configPath);
    // Boolean("true") === true
    expect(config).toEqual({ verbose: true });
  });

  it("handles empty scanners array", async () => {
    const configPath = join(tempDir, "empty-scanners.yml");
    await writeFile(configPath, "scanners: []\n");

    const config = await loadConfig(configPath);
    expect(config).toEqual({ scanners: [] });
  });

  it("handles config file that is 0 bytes", async () => {
    const configPath = join(tempDir, "zero-bytes.yml");
    await writeFile(configPath, "");

    const config = await loadConfig(configPath);
    expect(config).toEqual({});
  });

  it("handles config file with only comments", async () => {
    const configPath = join(tempDir, "comments-only.yml");
    await writeFile(configPath, "# This is a comment\n# Another comment\n");

    const config = await loadConfig(configPath);
    expect(config).toEqual({});
  });

  it("throws on malformed YAML (tabs for indentation)", async () => {
    const configPath = join(tempDir, "malformed.yml");
    await writeFile(configPath, "format: json\nscanners:\n\t- crontab\n");

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("throws on YAML with unmatched brackets", async () => {
    const configPath = join(tempDir, "bad-brackets.yml");
    await writeFile(configPath, "scanners: [crontab, systemd\n");

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("throws when config path is a directory instead of file", async () => {
    const dirPath = join(tempDir, "config-dir");
    await mkdir(dirPath, { recursive: true });

    await expect(loadConfig(dirPath)).rejects.toThrow();
  });

  it("handles extremely long scanner names", async () => {
    const longName = "a".repeat(10000);
    const configPath = join(tempDir, "long-scanner.yml");
    await writeFile(
      configPath,
      `scanners:\n  - ${longName}\n`,
    );

    const config = await loadConfig(configPath);
    expect(config!.scanners).toEqual([longName]);
  });

  it("keeps duplicate scanner entries as-is", async () => {
    const configPath = join(tempDir, "dup-scanners.yml");
    await writeFile(
      configPath,
      "scanners:\n  - crontab\n  - systemd\n  - crontab\n",
    );

    const config = await loadConfig(configPath);
    expect(config!.scanners).toEqual(["crontab", "systemd", "crontab"]);
  });

  it("preserves mixed case scanner names", async () => {
    const configPath = join(tempDir, "mixedcase-scanners.yml");
    await writeFile(
      configPath,
      "scanners:\n  - CronTab\n  - SYSTEMD\n  - Kubernetes\n",
    );

    const config = await loadConfig(configPath);
    expect(config!.scanners).toEqual(["CronTab", "SYSTEMD", "Kubernetes"]);
  });

  it("throws when YAML root is a list instead of mapping", async () => {
    const configPath = join(tempDir, "list-root.yml");
    await writeFile(configPath, "- crontab\n- systemd\n");

    await expect(loadConfig(configPath)).rejects.toThrow(
      /expected a YAML mapping/,
    );
  });

  it("throws when YAML root is a scalar", async () => {
    const configPath = join(tempDir, "scalar-root.yml");
    await writeFile(configPath, "just a plain string\n");

    await expect(loadConfig(configPath)).rejects.toThrow(
      /expected a YAML mapping/,
    );
  });

  it("converts numeric scanner entries to strings", async () => {
    const configPath = join(tempDir, "numeric-scanners.yml");
    await writeFile(configPath, "scanners:\n  - 123\n  - 456\n");

    const config = await loadConfig(configPath);
    expect(config!.scanners).toEqual(["123", "456"]);
  });
});

describe("null values in config YAML", () => {
  it("verbose: null silently becomes false via Boolean(null)", async () => {
    const configPath = join(tempDir, "null-verbose.yml");
    await writeFile(configPath, "verbose: null\n");

    const config = await loadConfig(configPath);
    expect(config).toEqual({ verbose: false });
  });

  it("format: null throws invalid format error", async () => {
    const configPath = join(tempDir, "null-format.yml");
    await writeFile(configPath, "format: null\n");

    await expect(loadConfig(configPath)).rejects.toThrow(/Invalid format/);
  });

  it("scanners: null throws expected-a-list error", async () => {
    const configPath = join(tempDir, "null-scanners.yml");
    await writeFile(configPath, "scanners: null\n");

    await expect(loadConfig(configPath)).rejects.toThrow(/expected a list/);
  });
});

describe("CLI --config flag", () => {
  const CLI_PATH = resolve(import.meta.dirname, "../dist/cli.js");
  const NODE_PATH = process.execPath;
  const MINIMAL_PATH = dirname(NODE_PATH);

  function run(
    args: string[],
    env?: Record<string, string>,
  ): { stdout: string; stderr: string; exitCode: number } {
    try {
      const stdout = execFileSync(NODE_PATH, [CLI_PATH, ...args], {
        encoding: "utf-8",
        timeout: 10000,
        env: {
          PATH: MINIMAL_PATH,
          HOME: "/nonexistent",
          AWS_ACCESS_KEY_ID: "",
          AWS_SECRET_ACCESS_KEY: "",
          KUBECONFIG: "/nonexistent",
          NODE_PATH: "",
          ...env,
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

  it("scan --config loads format from config file", async () => {
    const configPath = join(tempDir, "cli-test.yml");
    await writeFile(configPath, "format: json\n");

    const { stdout, exitCode } = run([
      "scan",
      "--config",
      configPath,
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("CLI flags override config file values", async () => {
    const configPath = join(tempDir, "override-test.yml");
    await writeFile(configPath, "format: yaml\n");

    const { stdout, exitCode } = run([
      "scan",
      "--config",
      configPath,
      "--format",
      "json",
    ]);
    expect(exitCode).toBe(0);
    // Should be JSON (CLI flag), not YAML (config)
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("errors when --config points to nonexistent file", async () => {
    const { exitCode, stderr } = run([
      "scan",
      "--config",
      join(tempDir, "does-not-exist.yml"),
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Config file not found");
  });

  it("help documents --config flag", () => {
    const { stdout } = run(["scan", "--help"]);
    expect(stdout).toContain("--config");
  });

  it("--scanners CLI flag overrides config scanners", async () => {
    const configPath = join(tempDir, "scanners-override.yml");
    await writeFile(
      configPath,
      "scanners:\n  - kubernetes\n  - systemd\n",
    );

    const { stdout, exitCode } = run([
      "scan",
      "--config",
      configPath,
      "--scanners",
      "crontab",
      "--format",
      "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("--format CLI flag overrides config format", async () => {
    const configPath = join(tempDir, "format-override.yml");
    await writeFile(configPath, "format: table\n");

    const { stdout, exitCode } = run([
      "scan",
      "--config",
      configPath,
      "--format",
      "yaml",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("[]");
  });
});
