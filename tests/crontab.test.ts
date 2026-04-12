import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanOptions } from "../src/types.js";

// Mock child_process.execFile before importing the scanner
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { CrontabScanner } from "../src/scanners/crontab.js";

// Type the mocked execFile to work with promisify
const mockedExecFile = vi.mocked(execFile);
const mockedReadFile = vi.mocked(readFile);
const mockedReaddir = vi.mocked(readdir);

/** Helper to make execFile resolve with stdout */
function mockExecSuccess(stdout: string): void {
  mockedExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
    (callback as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
      stdout,
      stderr: "",
    });
    return undefined as ReturnType<typeof execFile>;
  });
}

/** Helper to make execFile reject with an error */
function mockExecError(message: string): void {
  mockedExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
    const err = new Error(message);
    (callback as (err: Error) => void)(err);
    return undefined as ReturnType<typeof execFile>;
  });
}

/** Helper to make execFile resolve differently per command */
function mockExecByCommand(handlers: Record<string, string | Error>): void {
  mockedExecFile.mockImplementation((cmd: unknown, args: unknown, _opts: unknown, callback: unknown) => {
    const command = cmd as string;
    const argList = args as string[];
    const fullCmd = `${command} ${argList.join(" ")}`;
    for (const [key, value] of Object.entries(handlers)) {
      if (fullCmd.includes(key)) {
        if (value instanceof Error) {
          (callback as (err: Error) => void)(value);
        } else {
          (callback as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
            stdout: value,
            stderr: "",
          });
        }
        return undefined as ReturnType<typeof execFile>;
      }
    }
    (callback as (err: Error) => void)(new Error(`Unexpected command: ${fullCmd}`));
    return undefined as ReturnType<typeof execFile>;
  });
}

const defaultOptions: ScanOptions = {};

describe("CrontabScanner", () => {
  let scanner: CrontabScanner;

  beforeEach(() => {
    vi.clearAllMocks();
    scanner = new CrontabScanner();
    // Default: no system crontabs
    mockedReadFile.mockRejectedValue(new Error("ENOENT"));
    mockedReaddir.mockRejectedValue(new Error("ENOENT"));
  });

  describe("name", () => {
    it("should be 'crontab'", () => {
      expect(scanner.name).toBe("crontab");
    });
  });

  describe("isAvailable", () => {
    it("returns true when crontab command exists", async () => {
      mockExecSuccess("/usr/bin/crontab\n");
      expect(await scanner.isAvailable()).toBe(true);
    });

    it("returns false when crontab command is not found", async () => {
      mockExecError("which: no crontab in PATH");
      expect(await scanner.isAvailable()).toBe(false);
    });
  });

  describe("scan — user crontab", () => {
    it("parses multiple normal crontab entries", async () => {
      mockExecByCommand({
        "crontab -l": [
          "0 2 * * * /usr/bin/backup.sh",
          "*/15 * * * * /usr/local/bin/check-health",
          "30 8 * * 1-5 /home/user/report.py --send",
        ].join("\n"),
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(3);

      expect(tasks[0].name).toBe("backup.sh");
      expect(tasks[0].schedule).toBe("0 2 * * *");
      expect(tasks[0].command).toBe("/usr/bin/backup.sh");
      expect(tasks[0].source).toBe("crontab");
      expect(tasks[0].nextRun).toBeInstanceOf(Date);
      expect(tasks[0].interval).toBe("Every day at 2 AM");

      expect(tasks[1].name).toBe("check-health");
      expect(tasks[1].schedule).toBe("*/15 * * * *");
      expect(tasks[1].command).toBe("/usr/local/bin/check-health");
      expect(tasks[1].interval).toBe("Every 15 minutes");

      expect(tasks[2].name).toBe("report.py");
      expect(tasks[2].schedule).toBe("30 8 * * 1-5");
      expect(tasks[2].command).toBe("/home/user/report.py --send");
    });

    it("skips comment lines", async () => {
      mockExecByCommand({
        "crontab -l": [
          "# This is a comment",
          "0 2 * * * /usr/bin/backup.sh",
          "# Another comment",
        ].join("\n"),
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].command).toBe("/usr/bin/backup.sh");
    });

    it("skips environment variable lines", async () => {
      mockExecByCommand({
        "crontab -l": [
          "SHELL=/bin/bash",
          "PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin",
          "MAILTO=admin@example.com",
          "0 2 * * * /usr/bin/backup.sh",
        ].join("\n"),
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].command).toBe("/usr/bin/backup.sh");
    });

    it("handles blank lines gracefully", async () => {
      mockExecByCommand({
        "crontab -l": [
          "",
          "0 2 * * * /usr/bin/backup.sh",
          "",
          "0 3 * * * /usr/bin/cleanup.sh",
          "",
        ].join("\n"),
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(2);
    });

    it("returns empty array when no crontab is installed", async () => {
      mockExecByCommand({
        "crontab -l": new Error("no crontab for user"),
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array on permission denied", async () => {
      mockExecByCommand({
        "crontab -l": new Error("Permission denied"),
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array for empty crontab output", async () => {
      mockExecByCommand({
        "crontab -l": "",
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("handles mixed comments, env vars, blanks, and entries", async () => {
      mockExecByCommand({
        "crontab -l": [
          "# crontab for deploy user",
          "SHELL=/bin/bash",
          "PATH=/usr/bin:/usr/local/bin",
          "",
          "0 * * * * /usr/bin/hourly-check",
          "# nightly cleanup",
          "0 3 * * * /usr/bin/cleanup",
          "",
        ].join("\n"),
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].command).toBe("/usr/bin/hourly-check");
      expect(tasks[1].command).toBe("/usr/bin/cleanup");
    });
  });

  describe("scan — @-shortcut entries", () => {
    it("parses @daily shortcut", async () => {
      mockExecByCommand({
        "crontab -l": "@daily /usr/bin/backup.sh",
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].schedule).toBe("0 0 * * *");
      expect(tasks[0].command).toBe("/usr/bin/backup.sh");
      expect(tasks[0].nextRun).toBeInstanceOf(Date);
    });

    it("parses @hourly shortcut", async () => {
      mockExecByCommand({
        "crontab -l": "@hourly /usr/bin/check-health",
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].schedule).toBe("0 * * * *");
      expect(tasks[0].command).toBe("/usr/bin/check-health");
    });

    it("parses @weekly shortcut", async () => {
      mockExecByCommand({
        "crontab -l": "@weekly /usr/bin/weekly-report",
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].schedule).toBe("0 0 * * 0");
    });

    it("parses @monthly shortcut", async () => {
      mockExecByCommand({
        "crontab -l": "@monthly /usr/bin/monthly-cleanup",
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].schedule).toBe("0 0 1 * *");
    });

    it("parses @yearly and @annually shortcuts", async () => {
      mockExecByCommand({
        "crontab -l": "@yearly /usr/bin/annual-report\n@annually /usr/bin/audit",
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].schedule).toBe("0 0 1 1 *");
      expect(tasks[1].schedule).toBe("0 0 1 1 *");
    });

    it("parses @midnight shortcut", async () => {
      mockExecByCommand({
        "crontab -l": "@midnight /usr/bin/nightly-job",
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].schedule).toBe("0 0 * * *");
    });

    it("handles @reboot gracefully with undefined nextRun", async () => {
      mockExecByCommand({
        "crontab -l": "@reboot /usr/bin/startup-script",
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].schedule).toBe("@reboot");
      expect(tasks[0].command).toBe("/usr/bin/startup-script");
      expect(tasks[0].nextRun).toBeUndefined();
    });

    it("silently skips unknown @-shortcuts", async () => {
      mockExecByCommand({
        "crontab -l": "@unknown /bin/cmd",
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("silently skips @-shortcut with missing command", async () => {
      mockExecByCommand({
        "crontab -l": "@daily",
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("silently skips system crontab @-shortcut missing command after user", async () => {
      mockExecByCommand({
        "crontab -l": new Error("no crontab for user"),
        "which": "/usr/bin/crontab",
      });

      mockedReadFile.mockImplementation((path: unknown) => {
        if (path === "/etc/crontab") {
          return Promise.resolve("@daily root\n");
        }
        return Promise.reject(new Error("ENOENT"));
      });
      mockedReaddir.mockRejectedValue(new Error("ENOENT"));

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("handles mixed @-shortcuts and normal entries", async () => {
      mockExecByCommand({
        "crontab -l": [
          "@daily /usr/bin/backup.sh",
          "0 2 * * * /usr/bin/nightly",
          "@reboot /usr/bin/startup",
        ].join("\n"),
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(3);
      expect(tasks[0].schedule).toBe("0 0 * * *");
      expect(tasks[1].schedule).toBe("0 2 * * *");
      expect(tasks[2].schedule).toBe("@reboot");
    });

    it("parses @-shortcuts in system crontab format (with user field)", async () => {
      mockExecByCommand({
        "crontab -l": new Error("no crontab for user"),
        "which": "/usr/bin/crontab",
      });

      mockedReadFile.mockImplementation((path: unknown) => {
        if (path === "/etc/crontab") {
          return Promise.resolve("@daily root /usr/bin/sys-cleanup\n");
        }
        return Promise.reject(new Error("ENOENT"));
      });
      mockedReaddir.mockRejectedValue(new Error("ENOENT"));

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].schedule).toBe("0 0 * * *");
      expect(tasks[0].command).toBe("/usr/bin/sys-cleanup");
      expect(tasks[0].metadata?.user).toBe("root");
    });
  });

  describe("scan — system crontabs", () => {
    it("parses /etc/crontab with system format (user field)", async () => {
      mockExecByCommand({
        "crontab -l": new Error("no crontab for user"),
        "which": "/usr/bin/crontab",
      });

      mockedReadFile.mockImplementation((path: unknown) => {
        if (path === "/etc/crontab") {
          return Promise.resolve([
            "# /etc/crontab: system-wide crontab",
            "SHELL=/bin/sh",
            "PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin",
            "",
            "17 * * * * root cd / && run-parts --report /etc/cron.hourly",
            "25 6 * * * root test -x /usr/sbin/anacron || run-parts --report /etc/cron.daily",
          ].join("\n"));
        }
        return Promise.reject(new Error("ENOENT"));
      });
      mockedReaddir.mockRejectedValue(new Error("ENOENT"));

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(2);

      expect(tasks[0].schedule).toBe("17 * * * *");
      expect(tasks[0].command).toBe("cd / && run-parts --report /etc/cron.hourly");
      expect(tasks[0].metadata?.user).toBe("root");
      expect(tasks[0].metadata?.type).toBe("system");
      expect(tasks[0].metadata?.file).toBe("/etc/crontab");

      expect(tasks[1].schedule).toBe("25 6 * * *");
      expect(tasks[1].metadata?.user).toBe("root");
    });

    it("parses files in /etc/cron.d/", async () => {
      mockExecByCommand({
        "crontab -l": new Error("no crontab for user"),
        "which": "/usr/bin/crontab",
      });

      mockedReadFile.mockImplementation((path: unknown) => {
        if (path === "/etc/cron.d/logrotate") {
          return Promise.resolve("0 0 * * * root /usr/sbin/logrotate /etc/logrotate.conf\n");
        }
        return Promise.reject(new Error("ENOENT"));
      });
      mockedReaddir.mockResolvedValue(["logrotate"] as unknown as Awaited<ReturnType<typeof readdir>>);

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].command).toBe("/usr/sbin/logrotate /etc/logrotate.conf");
      expect(tasks[0].metadata?.user).toBe("root");
      expect(tasks[0].metadata?.file).toBe("/etc/cron.d/logrotate");
    });

    it("skips hidden files in /etc/cron.d/", async () => {
      mockExecByCommand({
        "crontab -l": new Error("no crontab for user"),
        "which": "/usr/bin/crontab",
      });

      mockedReadFile.mockRejectedValue(new Error("ENOENT"));
      mockedReaddir.mockResolvedValue([".placeholder", "logrotate"] as unknown as Awaited<ReturnType<typeof readdir>>);

      // Only logrotate should be attempted
      const readFileCalls: string[] = [];
      mockedReadFile.mockImplementation((path: unknown) => {
        readFileCalls.push(path as string);
        if ((path as string).includes("logrotate")) {
          return Promise.resolve("0 0 * * * root /usr/sbin/logrotate\n");
        }
        return Promise.reject(new Error("ENOENT"));
      });

      await scanner.scan(defaultOptions);
      expect(readFileCalls).not.toContain("/etc/cron.d/.placeholder");
    });

    it("combines user and system crontab results", async () => {
      mockExecByCommand({
        "crontab -l": "0 2 * * * /usr/bin/backup.sh",
        "which": "/usr/bin/crontab",
      });

      mockedReadFile.mockImplementation((path: unknown) => {
        if (path === "/etc/crontab") {
          return Promise.resolve("0 3 * * * root /usr/bin/sys-cleanup\n");
        }
        return Promise.reject(new Error("ENOENT"));
      });
      mockedReaddir.mockRejectedValue(new Error("ENOENT"));

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].metadata?.type).toBe("user");
      expect(tasks[1].metadata?.type).toBe("system");
    });

    it("continues gracefully when /etc/crontab is not readable", async () => {
      mockExecByCommand({
        "crontab -l": "0 2 * * * /usr/bin/backup.sh",
        "which": "/usr/bin/crontab",
      });

      mockedReadFile.mockRejectedValue(new Error("EACCES"));
      mockedReaddir.mockRejectedValue(new Error("ENOENT"));

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].command).toBe("/usr/bin/backup.sh");
    });

    it("continues gracefully when /etc/cron.d does not exist", async () => {
      mockExecByCommand({
        "crontab -l": "0 2 * * * /usr/bin/backup.sh",
        "which": "/usr/bin/crontab",
      });

      mockedReadFile.mockRejectedValue(new Error("ENOENT"));
      mockedReaddir.mockRejectedValue(new Error("ENOENT"));

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
    });
  });

  describe("scan — task field correctness", () => {
    it("derives task name from command basename", async () => {
      mockExecByCommand({
        "crontab -l": "0 0 * * * /opt/scripts/nightly/database-backup.sh --full",
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks[0].name).toBe("database-backup.sh");
    });

    it("sets source to 'crontab'", async () => {
      mockExecByCommand({
        "crontab -l": "0 0 * * * /usr/bin/task",
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks[0].source).toBe("crontab");
    });

    it("computes nextRun and interval from schedule", async () => {
      mockExecByCommand({
        "crontab -l": "0 2 * * * /usr/bin/nightly",
        "which": "/usr/bin/crontab",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks[0].nextRun).toBeInstanceOf(Date);
      expect(tasks[0].interval).toBe("Every day at 2 AM");
    });
  });
});
