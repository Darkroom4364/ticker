import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Scanner, ScanOptions, ScheduledTask } from "../types.js";

const execAsync = promisify(exec);

/**
 * Parse the tabular output of `systemctl list-timers --all --no-pager`.
 *
 * Example output:
 * NEXT                         LEFT          LAST                         PASSED       UNIT                         ACTIVATES
 * Mon 2025-01-20 00:00:00 UTC  5h left       Sun 2025-01-19 00:00:00 UTC  18h ago      logrotate.timer              logrotate.service
 * Mon 2025-01-20 06:30:00 UTC  11h left      Sun 2025-01-19 06:30:00 UTC  12h ago      systemd-tmpfiles-clean.timer systemd-tmpfiles-clean.service
 *
 * 2 timers listed.
 */
function parseTimerOutput(stdout: string): Array<{
  next: string;
  unit: string;
  activates: string;
}> {
  const lines = stdout.split("\n");
  const results: Array<{ next: string; unit: string; activates: string }> = [];

  // Find the header line
  const headerIndex = lines.findIndex((line) => line.includes("NEXT") && line.includes("UNIT"));
  if (headerIndex === -1) return results;

  const headerLine = lines[headerIndex];
  const nextCol = headerLine.indexOf("NEXT");
  const leftCol = headerLine.indexOf("LEFT");
  const unitCol = headerLine.indexOf("UNIT");
  const activatesCol = headerLine.indexOf("ACTIVATES");

  if (leftCol === -1 || unitCol === -1) return results;

  // Parse data lines (after header, before summary)
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    // Stop at blank line or summary line
    if (line.trim() === "" || /^\d+ timers? listed/.test(line.trim())) break;

    // Skip lines that are too short
    if (line.length < unitCol) continue;

    const next = line.substring(nextCol, leftCol).trim();
    const unitPart = activatesCol >= 0
      ? line.substring(unitCol, activatesCol).trim()
      : line.substring(unitCol).trim();
    const activates = activatesCol >= 0
      ? line.substring(activatesCol).trim()
      : "";

    if (unitPart) {
      results.push({ next, unit: unitPart, activates });
    }
  }

  return results;
}

/** Try to get the calendar expression from a timer unit file */
async function getTimerCalendar(unit: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(
      `systemctl show ${unit} --property=TimersCalendar --no-pager`,
    );
    // Output format: TimersCalendar={ OnCalendar=daily ; next_elapse=Mon 2025-01-20 00:00:00 UTC }
    const match = stdout.match(/OnCalendar=([^;}\n]+)/);
    if (match) return match[1].trim();
  } catch {
    // Can't read unit details — fall back
  }
  return undefined;
}

/** Try to get the description of a service unit */
async function getServiceDescription(service: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(
      `systemctl show ${service} --property=Description --no-pager`,
    );
    const match = stdout.match(/Description=(.+)/);
    if (match) return match[1].trim();
  } catch {
    // Can't read service details
  }
  return undefined;
}

/** Parse a date string from systemctl output like "Mon 2025-01-20 00:00:00 UTC" */
function parseSystemdDate(dateStr: string): Date | undefined {
  if (!dateStr || dateStr === "n/a") return undefined;

  // systemctl outputs: "DayName YYYY-MM-DD HH:MM:SS TZ"
  // Strip the leading day name (e.g., "Mon ") if present
  const stripped = dateStr.replace(/^[A-Za-z]+\s+/, "");
  const date = new Date(stripped);
  return isNaN(date.getTime()) ? undefined : date;
}

export class SystemdScanner implements Scanner {
  name = "systemd";

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync("which systemctl");
      return true;
    } catch {
      return false;
    }
  }

  async scan(_options: ScanOptions): Promise<ScheduledTask[]> {
    const tasks: ScheduledTask[] = [];

    try {
      const { stdout } = await execAsync("systemctl list-timers --all --no-pager");
      const timers = parseTimerOutput(stdout);

      for (const timer of timers) {
        const calendar = await getTimerCalendar(timer.unit);
        const description = timer.activates
          ? await getServiceDescription(timer.activates)
          : undefined;

        const nextRun = parseSystemdDate(timer.next);

        const task: ScheduledTask = {
          name: timer.unit.replace(/\.timer$/, ""),
          schedule: calendar ?? "systemd timer",
          source: "systemd",
          nextRun,
          interval: calendar ?? undefined,
          command: timer.activates || undefined,
          metadata: {
            unit: timer.unit,
            ...(timer.activates ? { activates: timer.activates } : {}),
            ...(description ? { description } : {}),
          },
        };

        tasks.push(task);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("Permission denied") ||
        message.includes("EACCES") ||
        message.includes("Connection refused") ||
        message.includes("Failed to connect")
      ) {
        return [];
      }
      return [];
    }

    return tasks;
  }
}
