import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanOptions } from "../src/types.js";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

import { exec, execFile } from "node:child_process";
import { SystemdScanner } from "../src/scanners/systemd.js";

const mockedExec = vi.mocked(exec);
const mockedExecFile = vi.mocked(execFile);

/** Helper to make exec resolve differently per command pattern */
function mockExecByCommand(handlers: Record<string, string | Error>): void {
  mockedExec.mockImplementation((cmd: unknown, callback: unknown) => {
    const command = cmd as string;
    for (const [key, value] of Object.entries(handlers)) {
      if (command.includes(key)) {
        if (value instanceof Error) {
          (callback as (err: Error) => void)(value);
        } else {
          (callback as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
            stdout: value,
            stderr: "",
          });
        }
        return undefined as ReturnType<typeof exec>;
      }
    }
    // Default: return empty
    (callback as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
      stdout: "",
      stderr: "",
    });
    return undefined as ReturnType<typeof exec>;
  });

  // Mock execFile for systemctl show calls (getTimerCalendar and getServiceDescription)
  mockedExecFile.mockImplementation((_cmd: unknown, args: unknown, callback: unknown) => {
    const argList = args as string[];
    const argStr = argList.join(" ");
    for (const [key, value] of Object.entries(handlers)) {
      if (argStr.includes(key)) {
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
    (callback as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
      stdout: "",
      stderr: "",
    });
    return undefined as ReturnType<typeof execFile>;
  });
}

const NORMAL_TIMER_OUTPUT = `NEXT                         LEFT          LAST                         PASSED       UNIT                         ACTIVATES
Mon 2025-01-20 00:00:00 UTC  5h left       Sun 2025-01-19 00:00:00 UTC  18h ago      logrotate.timer              logrotate.service
Mon 2025-01-20 06:30:00 UTC  11h left      Sun 2025-01-19 06:30:00 UTC  12h ago      systemd-tmpfiles-clean.timer systemd-tmpfiles-clean.service
Tue 2025-01-21 03:00:00 UTC  1 day left    Mon 2025-01-20 03:00:00 UTC  3h ago       apt-daily.timer              apt-daily.service

3 timers listed.
`;

const EMPTY_TIMER_OUTPUT = `NEXT LEFT LAST PASSED UNIT ACTIVATES

0 timers listed.
`;

const defaultOptions: ScanOptions = {};

describe("SystemdScanner", () => {
  let scanner: SystemdScanner;

  beforeEach(() => {
    vi.clearAllMocks();
    scanner = new SystemdScanner();
  });

  describe("name", () => {
    it("should be 'systemd'", () => {
      expect(scanner.name).toBe("systemd");
    });
  });

  describe("isAvailable", () => {
    it("returns true when systemctl exists", async () => {
      mockExecByCommand({ "which systemctl": "/usr/bin/systemctl" });
      expect(await scanner.isAvailable()).toBe(true);
    });

    it("returns false when systemctl is not found", async () => {
      mockExecByCommand({ "which systemctl": new Error("which: no systemctl in PATH") });
      expect(await scanner.isAvailable()).toBe(false);
    });
  });

  describe("scan", () => {
    it("parses normal output with multiple timers", async () => {
      mockExecByCommand({
        "list-timers": NORMAL_TIMER_OUTPUT,
        "TimersCalendar": "TimersCalendar={ OnCalendar=daily ; next_elapse=Mon 2025-01-20 }",
        "Description": "Description=Rotate log files",
      });

      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(3);

      expect(tasks[0].name).toBe("logrotate");
      expect(tasks[0].source).toBe("systemd");
      expect(tasks[0].schedule).toBe("daily");
      expect(tasks[0].nextRun).toBeInstanceOf(Date);
      expect(tasks[0].metadata?.unit).toBe("logrotate.timer");
      expect(tasks[0].metadata?.activates).toBe("logrotate.service");

      expect(tasks[1].name).toBe("systemd-tmpfiles-clean");
      expect(tasks[1].metadata?.unit).toBe("systemd-tmpfiles-clean.timer");

      expect(tasks[2].name).toBe("apt-daily");
      expect(tasks[2].metadata?.activates).toBe("apt-daily.service");
    });

    it("returns empty array for empty timer output", async () => {
      mockExecByCommand({
        "list-timers": EMPTY_TIMER_OUTPUT,
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array when systemctl is not found", async () => {
      mockExecByCommand({
        "list-timers": new Error("command not found: systemctl"),
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array on permission denied", async () => {
      mockExecByCommand({
        "list-timers": new Error("Permission denied"),
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array on connection refused", async () => {
      mockExecByCommand({
        "list-timers": new Error("Failed to connect to bus: Connection refused"),
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("handles malformed output gracefully", async () => {
      mockExecByCommand({
        "list-timers": "some random garbage output\nwith no header",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("falls back to 'systemd timer' when calendar expression unavailable", async () => {
      mockExecByCommand({
        "list-timers": NORMAL_TIMER_OUTPUT,
        "TimersCalendar": new Error("not available"),
        "Description": new Error("not available"),
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks[0].schedule).toBe("systemd timer");
    });

    it("parses next run date from systemctl output", async () => {
      mockExecByCommand({
        "list-timers": NORMAL_TIMER_OUTPUT,
        "TimersCalendar": "TimersCalendar={ OnCalendar=daily ; next_elapse=Mon 2025-01-20 }",
        "Description": "Description=Rotate log files",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks[0].nextRun).toBeInstanceOf(Date);
      expect(tasks[0].nextRun?.toISOString()).toContain("2025-01-20");
    });

    it("sets source to 'systemd' for all tasks", async () => {
      mockExecByCommand({
        "list-timers": NORMAL_TIMER_OUTPUT,
        "TimersCalendar": "TimersCalendar={ OnCalendar=*-*-* 06:30:00 ; next_elapse=Mon }",
        "Description": "Description=Test",
      });

      const tasks = await scanner.scan(defaultOptions);
      for (const task of tasks) {
        expect(task.source).toBe("systemd");
      }
    });

    it("uses execFile (not exec) for systemctl show to prevent command injection", async () => {
      const maliciousUnit = "evil$(rm -rf /).timer";
      const timerOutput = `NEXT                         LEFT          LAST                         PASSED       UNIT                         ACTIVATES
Mon 2025-01-20 00:00:00 UTC  5h left       Sun 2025-01-19 00:00:00 UTC  18h ago      ${maliciousUnit}              evil.service

1 timers listed.
`;
      mockExecByCommand({
        "list-timers": timerOutput,
        "TimersCalendar": "TimersCalendar={ OnCalendar=daily ; next_elapse=Mon 2025-01-20 }",
        "Description": "Description=Evil",
      });

      await scanner.scan(defaultOptions);

      // Verify execFile was called (not exec) for the show commands
      // execFile passes arguments as an array, preventing shell injection
      expect(mockedExecFile).toHaveBeenCalled();
      const calls = mockedExecFile.mock.calls;
      for (const call of calls) {
        // First arg is the command, second is the args array
        expect(call[0]).toBe("systemctl");
        expect(Array.isArray(call[1])).toBe(true);
      }
    });
  });
});
