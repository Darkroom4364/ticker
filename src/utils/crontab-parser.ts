/** Regex to detect environment variable lines like SHELL=/bin/bash */
export const ENV_VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Map @-shortcut names to standard 5-field cron expressions */
export const CRON_SHORTCUTS: Record<string, string | null> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
  "@reboot": null, // Special: no cron equivalent
};

/** Extract the command name (first word/path basename) for the task name */
export function deriveTaskName(command: string): string {
  const firstWord = command.trim().split(/\s+/)[0];
  // Use basename if it looks like a path
  const basename = firstWord.split("/").pop() ?? firstWord;
  return basename;
}

/**
 * Parse a user-format crontab line (5 fields + command or @shortcut command):
 *   min hour dom mon dow command
 *   @daily command
 */
export function parseCronLine(
  line: string,
): { schedule: string; command: string } | null {
  const trimmed = line.trim();

  // Handle @-shortcut entries
  if (trimmed.startsWith("@")) {
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return null;
    const shortcut = parts[0].toLowerCase();
    if (!(shortcut in CRON_SHORTCUTS)) return null;
    const schedule = CRON_SHORTCUTS[shortcut] ?? shortcut;
    const command = parts.slice(1).join(" ");
    return { schedule, command };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 6) return null;

  const schedule = parts.slice(0, 5).join(" ");
  const command = parts.slice(5).join(" ");
  return { schedule, command };
}

/** Check if a line should be skipped (comment, blank, env var) */
export function shouldSkipLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return true;
  if (trimmed.startsWith("#")) return true;
  if (ENV_VAR_RE.test(trimmed)) return true;
  return false;
}
