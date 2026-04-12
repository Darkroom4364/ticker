import { describe, it, expect } from "vitest";
import {
  ENV_VAR_RE,
  CRON_SHORTCUTS,
  deriveTaskName,
  parseCronLine,
  shouldSkipLine,
} from "../src/utils/crontab-parser.js";

describe("deriveTaskName", () => {
  it("returns basename for absolute paths", () => {
    expect(deriveTaskName("/usr/bin/backup")).toBe("backup");
  });

  it("returns basename for deeply nested absolute paths", () => {
    expect(deriveTaskName("/opt/scripts/daily/cleanup.sh")).toBe("cleanup.sh");
  });

  it("returns basename for relative paths", () => {
    expect(deriveTaskName("./scripts/deploy.sh")).toBe("deploy.sh");
  });

  it("returns the word itself for a single word command", () => {
    expect(deriveTaskName("curl")).toBe("curl");
  });

  it("returns basename of first word when command has arguments", () => {
    expect(deriveTaskName("/usr/bin/python3 /opt/app/run.py --verbose")).toBe("python3");
  });

  it("ignores leading whitespace", () => {
    expect(deriveTaskName("   /usr/local/bin/node")).toBe("node");
  });

  it("ignores trailing whitespace", () => {
    expect(deriveTaskName("rsync   ")).toBe("rsync");
  });

  it("handles command with tabs as whitespace", () => {
    expect(deriveTaskName("\t/sbin/reboot\tnow")).toBe("reboot");
  });
});

describe("parseCronLine", () => {
  it("parses a standard 5-field cron line", () => {
    const result = parseCronLine("0 3 * * * /usr/bin/backup");
    expect(result).toEqual({ schedule: "0 3 * * *", command: "/usr/bin/backup" });
  });

  it("parses a standard line with multi-word command", () => {
    const result = parseCronLine("*/5 * * * * curl -s https://example.com/health");
    expect(result).toEqual({
      schedule: "*/5 * * * *",
      command: "curl -s https://example.com/health",
    });
  });

  it("returns null when fewer than 6 fields", () => {
    expect(parseCronLine("0 3 * * *")).toBeNull();
  });

  it("returns null for only 4 fields plus command", () => {
    expect(parseCronLine("0 3 * * backup")).toBeNull();
  });

  // @shortcuts — all 8
  it("parses @yearly shortcut", () => {
    const result = parseCronLine("@yearly /opt/rotate-logs.sh");
    expect(result).toEqual({ schedule: "0 0 1 1 *", command: "/opt/rotate-logs.sh" });
  });

  it("parses @annually shortcut", () => {
    const result = parseCronLine("@annually /opt/rotate-logs.sh");
    expect(result).toEqual({ schedule: "0 0 1 1 *", command: "/opt/rotate-logs.sh" });
  });

  it("parses @monthly shortcut", () => {
    const result = parseCronLine("@monthly /opt/bill.sh");
    expect(result).toEqual({ schedule: "0 0 1 * *", command: "/opt/bill.sh" });
  });

  it("parses @weekly shortcut", () => {
    const result = parseCronLine("@weekly /opt/weekly.sh");
    expect(result).toEqual({ schedule: "0 0 * * 0", command: "/opt/weekly.sh" });
  });

  it("parses @daily shortcut", () => {
    const result = parseCronLine("@daily /opt/daily.sh");
    expect(result).toEqual({ schedule: "0 0 * * *", command: "/opt/daily.sh" });
  });

  it("parses @midnight shortcut", () => {
    const result = parseCronLine("@midnight /opt/nightly.sh");
    expect(result).toEqual({ schedule: "0 0 * * *", command: "/opt/nightly.sh" });
  });

  it("parses @hourly shortcut", () => {
    const result = parseCronLine("@hourly /opt/check.sh");
    expect(result).toEqual({ schedule: "0 * * * *", command: "/opt/check.sh" });
  });

  it("parses @reboot shortcut and uses literal @reboot as schedule", () => {
    const result = parseCronLine("@reboot /opt/startup.sh");
    expect(result).toEqual({ schedule: "@reboot", command: "/opt/startup.sh" });
  });

  it("handles case insensitivity for shortcuts", () => {
    const result = parseCronLine("@Daily /opt/daily.sh");
    expect(result).toEqual({ schedule: "0 0 * * *", command: "/opt/daily.sh" });
  });

  it("handles uppercase shortcuts", () => {
    const result = parseCronLine("@HOURLY /opt/check.sh");
    expect(result).toEqual({ schedule: "0 * * * *", command: "/opt/check.sh" });
  });

  it("returns null for unknown @ shortcut", () => {
    expect(parseCronLine("@every5min /opt/task.sh")).toBeNull();
  });

  it("returns null for @ shortcut without command", () => {
    expect(parseCronLine("@daily")).toBeNull();
  });

  it("trims surrounding whitespace before parsing", () => {
    const result = parseCronLine("  @daily /opt/trimmed.sh  ");
    expect(result).toEqual({ schedule: "0 0 * * *", command: "/opt/trimmed.sh" });
  });

  it("handles shortcut with multi-word command", () => {
    const result = parseCronLine("@weekly tar czf /backup/weekly.tar.gz /data");
    expect(result).toEqual({
      schedule: "0 0 * * 0",
      command: "tar czf /backup/weekly.tar.gz /data",
    });
  });
});

describe("shouldSkipLine", () => {
  it("skips empty string", () => {
    expect(shouldSkipLine("")).toBe(true);
  });

  it("skips whitespace-only line", () => {
    expect(shouldSkipLine("   \t  ")).toBe(true);
  });

  it("skips comment lines", () => {
    expect(shouldSkipLine("# this is a comment")).toBe(true);
  });

  it("skips comment with leading whitespace", () => {
    expect(shouldSkipLine("  # indented comment")).toBe(true);
  });

  it("skips environment variable assignments", () => {
    expect(shouldSkipLine("SHELL=/bin/bash")).toBe(true);
  });

  it("skips env var with underscore prefix", () => {
    expect(shouldSkipLine("_MY_VAR=value")).toBe(true);
  });

  it("skips MAILTO env var", () => {
    expect(shouldSkipLine("MAILTO=admin@example.com")).toBe(true);
  });

  it("skips PATH env var", () => {
    expect(shouldSkipLine("PATH=/usr/bin:/usr/local/bin")).toBe(true);
  });

  it("does not skip a valid cron line", () => {
    expect(shouldSkipLine("0 3 * * * /usr/bin/backup")).toBe(false);
  });

  it("does not skip a shortcut cron line", () => {
    expect(shouldSkipLine("@daily /opt/daily.sh")).toBe(false);
  });

  it("does not skip a line starting with a number", () => {
    expect(shouldSkipLine("30 2 * * 1 /opt/task.sh")).toBe(false);
  });
});

describe("CRON_SHORTCUTS", () => {
  it("contains all 8 shortcuts", () => {
    const keys = Object.keys(CRON_SHORTCUTS);
    expect(keys).toHaveLength(8);
    expect(keys).toEqual(
      expect.arrayContaining([
        "@yearly",
        "@annually",
        "@monthly",
        "@weekly",
        "@daily",
        "@midnight",
        "@hourly",
        "@reboot",
      ]),
    );
  });

  it("maps @yearly and @annually to the same value", () => {
    expect(CRON_SHORTCUTS["@yearly"]).toBe("0 0 1 1 *");
    expect(CRON_SHORTCUTS["@annually"]).toBe("0 0 1 1 *");
  });

  it("maps @monthly correctly", () => {
    expect(CRON_SHORTCUTS["@monthly"]).toBe("0 0 1 * *");
  });

  it("maps @weekly correctly", () => {
    expect(CRON_SHORTCUTS["@weekly"]).toBe("0 0 * * 0");
  });

  it("maps @daily and @midnight to the same value", () => {
    expect(CRON_SHORTCUTS["@daily"]).toBe("0 0 * * *");
    expect(CRON_SHORTCUTS["@midnight"]).toBe("0 0 * * *");
  });

  it("maps @hourly correctly", () => {
    expect(CRON_SHORTCUTS["@hourly"]).toBe("0 * * * *");
  });

  it("maps @reboot to null", () => {
    expect(CRON_SHORTCUTS["@reboot"]).toBeNull();
  });
});

describe("ENV_VAR_RE", () => {
  it("matches standard env var assignment", () => {
    expect(ENV_VAR_RE.test("SHELL=/bin/bash")).toBe(true);
  });

  it("matches var starting with underscore", () => {
    expect(ENV_VAR_RE.test("_SECRET=foo")).toBe(true);
  });

  it("matches var with digits in name", () => {
    expect(ENV_VAR_RE.test("MY_VAR2=hello")).toBe(true);
  });

  it("matches lowercase var name", () => {
    expect(ENV_VAR_RE.test("path=/usr/bin")).toBe(true);
  });

  it("matches single letter var", () => {
    expect(ENV_VAR_RE.test("X=1")).toBe(true);
  });

  it("does not match line starting with a digit", () => {
    expect(ENV_VAR_RE.test("0 3 * * * /usr/bin/backup")).toBe(false);
  });

  it("does not match comment line", () => {
    expect(ENV_VAR_RE.test("# SHELL=/bin/bash")).toBe(false);
  });

  it("does not match line starting with @", () => {
    expect(ENV_VAR_RE.test("@daily /opt/task.sh")).toBe(false);
  });

  it("does not match line starting with space", () => {
    expect(ENV_VAR_RE.test(" VAR=value")).toBe(false);
  });

  it("does not match line starting with hyphen", () => {
    expect(ENV_VAR_RE.test("-flag=value")).toBe(false);
  });
});
