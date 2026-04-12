import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanOptions } from "../src/types.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { SystemdScanner } from "../src/scanners/systemd.js";

const mockedExecFile = vi.mocked(execFile);

/** Helper to make execFile resolve differently per command pattern */
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
    // Default: return empty
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

    it("returns empty results when header is missing NEXT column", async () => {
      const outputMissingNext = `LEFT          LAST                         PASSED       UNIT                         ACTIVATES
5h left       Sun 2025-01-19 00:00:00 UTC  18h ago      logrotate.timer              logrotate.service

1 timers listed.
`;
      mockExecByCommand({
        "list-timers": outputMissingNext,
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

    it("throws on unexpected errors", async () => {
      mockExecByCommand({
        "list-timers": new Error("ENOMEM: not enough memory"),
      });

      await expect(scanner.scan(defaultOptions)).rejects.toThrow("ENOMEM");
    });

    it("extracts correct fields when LEFT appears before NEXT in output", async () => {
      // Bug: parseTimerOutput uses substring(nextCol, leftCol) which assumes
      // NEXT always appears before LEFT in the header. When LEFT comes first,
      // leftCol < nextCol so substring(nextCol, leftCol) swaps and extracts
      // the LEFT value ("5h left") instead of the NEXT datetime.
      const reorderedOutput =
        "LEFT          NEXT                         LAST                         PASSED       UNIT                         ACTIVATES\n" +
        "5h left       Mon 2025-01-20 00:00:00 UTC  Sun 2025-01-19 00:00:00 UTC  18h ago      logrotate.timer              logrotate.service\n" +
        "\n" +
        "1 timers listed.\n";

      mockExecByCommand({
        "list-timers": reorderedOutput,
        "TimersCalendar": "TimersCalendar={ OnCalendar=daily ; next_elapse=Mon 2025-01-20 }",
        "Description": "Description=Rotate log files",
      });

      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("logrotate");
      expect(tasks[0].metadata?.unit).toBe("logrotate.timer");
      // The next run date must be a valid Date parsed from the NEXT column
      expect(tasks[0].nextRun).toBeInstanceOf(Date);
      expect(tasks[0].nextRun!.toISOString()).toContain("2025-01-20");
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

    it("uses execFile for all systemctl calls to prevent command injection", async () => {
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

    it("handles timer output with extra columns", async () => {
      const extraColOutput = `NEXT                         LEFT          LAST                         PASSED       UNIT                         ACTIVATES                    EXTRA
Mon 2025-01-20 00:00:00 UTC  5h left       Sun 2025-01-19 00:00:00 UTC  18h ago      logrotate.timer              logrotate.service            something

1 timers listed.
`;
      mockExecByCommand({
        "list-timers": extraColOutput,
        "TimersCalendar": "TimersCalendar={ OnCalendar=daily ; next_elapse=Mon 2025-01-20 }",
        "Description": "Description=Rotate log files",
      });

      const tasks = await scanner.scan(defaultOptions);
      // The parser looks for NEXT, LEFT, UNIT, ACTIVATES columns -- extra columns shouldn't break it
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("logrotate");
    });

    it("handles output with missing LEFT column", async () => {
      const noLeftOutput = `NEXT                         LAST                         PASSED       UNIT                         ACTIVATES
Mon 2025-01-20 00:00:00 UTC  Sun 2025-01-19 00:00:00 UTC  18h ago      logrotate.timer              logrotate.service

1 timers listed.
`;
      mockExecByCommand({ "list-timers": noLeftOutput });
      const tasks = await scanner.scan(defaultOptions);
      // The parser requires LEFT column, so it returns empty
      expect(tasks).toHaveLength(0);
    });

    it("handles empty NEXT field", async () => {
      const emptyNextOutput = `NEXT                         LEFT          LAST                         PASSED       UNIT                         ACTIVATES
                             n/a           Sun 2025-01-19 00:00:00 UTC  18h ago      logrotate.timer              logrotate.service

1 timers listed.
`;
      mockExecByCommand({
        "list-timers": emptyNextOutput,
        "TimersCalendar": "TimersCalendar={ OnCalendar=daily ; next_elapse=n/a }",
        "Description": "Description=Rotate log files",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].nextRun).toBeUndefined();
    });

    it("handles 'n/a' in NEXT field", async () => {
      const naNextOutput = `NEXT                         LEFT          LAST                         PASSED       UNIT                         ACTIVATES
n/a                          n/a           Sun 2025-01-19 00:00:00 UTC  18h ago      dead.timer                   dead.service

1 timers listed.
`;
      mockExecByCommand({
        "list-timers": naNextOutput,
        "TimersCalendar": "TimersCalendar={ OnCalendar=daily ; next_elapse=n/a }",
        "Description": "Description=Dead timer",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].nextRun).toBeUndefined();
      expect(tasks[0].name).toBe("dead");
    });

    it("handles timezone info in timestamp", async () => {
      const tzOutput = `NEXT                              LEFT          LAST                              PASSED       UNIT                         ACTIVATES
Mon 2025-01-20 00:00:00 EST       5h left       Sun 2025-01-19 00:00:00 EST       18h ago      logrotate.timer              logrotate.service

1 timers listed.
`;
      mockExecByCommand({
        "list-timers": tzOutput,
        "TimersCalendar": "TimersCalendar={ OnCalendar=daily ; next_elapse=Mon 2025-01-20 }",
        "Description": "Description=Rotate log files",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("logrotate");
    });

    it("handles very long unit names", async () => {
      const longUnit = "a".repeat(200) + ".timer";
      const longService = "a".repeat(200) + ".service";
      const padding = " ".repeat(Math.max(0, 29 - longUnit.length));
      const timerOutput = `NEXT                         LEFT          LAST                         PASSED       UNIT                         ACTIVATES
Mon 2025-01-20 00:00:00 UTC  5h left       Sun 2025-01-19 00:00:00 UTC  18h ago      ${longUnit}${padding} ${longService}

1 timers listed.
`;
      mockExecByCommand({
        "list-timers": timerOutput,
        "TimersCalendar": "TimersCalendar={ OnCalendar=daily ; next_elapse=Mon 2025-01-20 }",
        "Description": "Description=Long timer",
      });

      const tasks = await scanner.scan(defaultOptions);
      // The unit name extends beyond the expected UNIT column width,
      // but the parser uses substring from column position so it should capture it
      expect(tasks.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty for output with only header, no data rows", async () => {
      const headerOnly = `NEXT                         LEFT          LAST                         PASSED       UNIT                         ACTIVATES

0 timers listed.
`;
      mockExecByCommand({ "list-timers": headerOnly });
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty for completely empty string output", async () => {
      mockExecByCommand({ "list-timers": "" });
      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("handles extra blank lines between rows", async () => {
      // Parser stops at blank line, so only the first timer should be parsed
      const extraBlanksOutput = `NEXT                         LEFT          LAST                         PASSED       UNIT                         ACTIVATES
Mon 2025-01-20 00:00:00 UTC  5h left       Sun 2025-01-19 00:00:00 UTC  18h ago      logrotate.timer              logrotate.service

Mon 2025-01-20 06:30:00 UTC  11h left      Sun 2025-01-19 06:30:00 UTC  12h ago      cleanup.timer                cleanup.service

2 timers listed.
`;
      mockExecByCommand({
        "list-timers": extraBlanksOutput,
        "TimersCalendar": "TimersCalendar={ OnCalendar=daily ; next_elapse=Mon 2025-01-20 }",
        "Description": "Description=Rotate log files",
      });

      const tasks = await scanner.scan(defaultOptions);
      // Parser breaks at blank line, so only the first timer before the blank line
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("logrotate");
    });

    it("handles unicode in timer names", async () => {
      const unicodeOutput = `NEXT                         LEFT          LAST                         PASSED       UNIT                         ACTIVATES
Mon 2025-01-20 00:00:00 UTC  5h left       Sun 2025-01-19 00:00:00 UTC  18h ago      caf\u00e9-backup.timer            caf\u00e9-backup.service

1 timers listed.
`;
      mockExecByCommand({
        "list-timers": unicodeOutput,
        "TimersCalendar": "TimersCalendar={ OnCalendar=daily ; next_elapse=Mon 2025-01-20 }",
        "Description": "Description=Backup",
      });

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("caf\u00e9-backup");
      expect(tasks[0].metadata?.unit).toBe("caf\u00e9-backup.timer");
    });
  });
});
