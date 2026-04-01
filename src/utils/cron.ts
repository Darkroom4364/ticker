/**
 * Cron expression parser — supports standard 5-field cron expressions
 * and named shortcuts. No external dependencies.
 *
 * Fields: minute hour day-of-month month day-of-week
 */

interface CronField {
  values: number[];
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

const NAMED_SHORTCUTS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const FIELD_RANGES: { min: number; max: number }[] = [
  { min: 0, max: 59 },  // minute
  { min: 0, max: 23 },  // hour
  { min: 1, max: 31 },  // day of month
  { min: 1, max: 12 },  // month
  { min: 0, max: 7 },   // day of week (0 and 7 = Sunday)
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseField(field: string, min: number, max: number): CronField {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    const range = stepMatch ? stepMatch[1] : part;

    if (step < 1) {
      throw new Error(`Invalid step value: ${step}`);
    }

    if (range === "*") {
      for (let i = min; i <= max; i += step) {
        values.add(i);
      }
    } else if (range.includes("-")) {
      const [startStr, endStr] = range.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
        throw new Error(`Invalid range: ${range} (must be ${min}-${max})`);
      }
      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    } else {
      const val = parseInt(range, 10);
      if (isNaN(val) || val < min || val > max) {
        throw new Error(`Invalid value: ${range} (must be ${min}-${max})`);
      }
      values.add(val);
    }
  }

  return { values: [...values].sort((a, b) => a - b) };
}

function parseCronFields(expr: string): ParsedCron {
  const normalized = NAMED_SHORTCUTS[expr.toLowerCase()] ?? expr;
  const fields = normalized.trim().split(/\s+/);

  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression: expected 5 fields, got ${fields.length} in "${expr}"`
    );
  }

  // Parse day-of-week and normalize 7 → 0 (both mean Sunday).
  // Preserve numeric order so 5-7 becomes [0,5,6] (Sun, Fri, Sat)
  // which sorts correctly for schedule matching. Display functions
  // handle the human-readable ordering separately.
  const dow = parseField(fields[4], FIELD_RANGES[4].min, FIELD_RANGES[4].max);
  const normalizedValues = new Set<number>();
  for (const v of dow.values) {
    normalizedValues.add(v === 7 ? 0 : v);
  }
  const normalizedDow: CronField = {
    values: [...normalizedValues].sort((a, b) => a - b),
  };

  return {
    minute: parseField(fields[0], FIELD_RANGES[0].min, FIELD_RANGES[0].max),
    hour: parseField(fields[1], FIELD_RANGES[1].min, FIELD_RANGES[1].max),
    dayOfMonth: parseField(fields[2], FIELD_RANGES[2].min, FIELD_RANGES[2].max),
    month: parseField(fields[3], FIELD_RANGES[3].min, FIELD_RANGES[3].max),
    dayOfWeek: normalizedDow,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function computeNextRun(parsed: ParsedCron, now: Date): Date {
  // Start one minute after now
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search up to 4 years ahead (handles leap years, etc.)
  const limit = new Date(now);
  limit.setFullYear(limit.getFullYear() + 4);

  while (candidate <= limit) {
    const month = candidate.getMonth() + 1; // 1-based
    if (!parsed.month.values.includes(month)) {
      // Skip to next valid month
      const nextMonth = parsed.month.values.find((m) => m > month);
      if (nextMonth !== undefined) {
        candidate.setMonth(nextMonth - 1, 1);
        candidate.setHours(0, 0, 0, 0);
      } else {
        // Wrap to first valid month of next year
        candidate.setFullYear(candidate.getFullYear() + 1);
        candidate.setMonth(parsed.month.values[0] - 1, 1);
        candidate.setHours(0, 0, 0, 0);
      }
      continue;
    }

    const dom = candidate.getDate();
    const dow = candidate.getDay();
    const maxDom = daysInMonth(candidate.getFullYear(), month);
    const validDoms = parsed.dayOfMonth.values.filter((d) => d <= maxDom);

    // POSIX cron: when both day-of-month and day-of-week are restricted
    // (non-wildcard), the job runs when EITHER matches (OR logic).
    // When only one is restricted, use AND logic (the wildcard always matches).
    const domRestricted = parsed.dayOfMonth.values.length < 31;
    const dowRestricted = parsed.dayOfWeek.values.length < 7;

    const domMatch = validDoms.includes(dom);
    const dowMatch = parsed.dayOfWeek.values.includes(dow);

    const dayMatch = domRestricted && dowRestricted
      ? domMatch || dowMatch
      : domMatch && dowMatch;

    if (!dayMatch) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    const hour = candidate.getHours();
    if (!parsed.hour.values.includes(hour)) {
      const nextHour = parsed.hour.values.find((h) => h > hour);
      if (nextHour !== undefined) {
        candidate.setHours(nextHour, 0, 0, 0);
        // Reset minute to start of range
        candidate.setMinutes(parsed.minute.values[0]);
      } else {
        // Move to next day
        candidate.setDate(candidate.getDate() + 1);
        candidate.setHours(0, 0, 0, 0);
      }
      continue;
    }

    const minute = candidate.getMinutes();
    if (!parsed.minute.values.includes(minute)) {
      const nextMinute = parsed.minute.values.find((m) => m > minute);
      if (nextMinute !== undefined) {
        candidate.setMinutes(nextMinute);
      } else {
        // Move to next hour
        candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      }
      continue;
    }

    // All fields match
    return candidate;
  }

  throw new Error(`Could not find next run within 4 years for expression`);
}

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const m = minute.toString().padStart(2, "0");
  if (minute === 0) {
    return `${h} ${period}`;
  }
  return `${h}:${m} ${period}`;
}

/**
 * Returns a human-readable description of a cron expression.
 */
export function describeCronExpression(expr: string): string {
  const lower = expr.trim().toLowerCase();

  if (lower === "@reboot") {
    return "At system reboot";
  }

  // Resolve named shortcuts for description
  const shortcutDescriptions: Record<string, string> = {
    "@yearly": "Every year on January 1st at 12 AM",
    "@annually": "Every year on January 1st at 12 AM",
    "@monthly": "Every month on the 1st at 12 AM",
    "@weekly": "Every Sunday at 12 AM",
    "@daily": "Every day at 12 AM",
    "@midnight": "Every day at 12 AM",
    "@hourly": "Every hour",
  };

  if (shortcutDescriptions[lower]) {
    return shortcutDescriptions[lower];
  }

  const parsed = parseCronFields(expr);

  const allMinutes = parsed.minute.values.length === 60;
  const allHours = parsed.hour.values.length === 24;
  const allDoms = parsed.dayOfMonth.values.length === 31;
  const allMonths = parsed.month.values.length === 12;
  const allDows = parsed.dayOfWeek.values.length === 7;

  // Every N minutes
  if (allHours && allDoms && allMonths && allDows) {
    if (parsed.minute.values.length === 1 && parsed.minute.values[0] === 0) {
      return "Every hour";
    }
    if (allMinutes) {
      return "Every minute";
    }
    // Check if it's a step pattern
    const mins = parsed.minute.values;
    if (mins.length > 1 && mins[0] === 0) {
      const step = mins[1] - mins[0];
      const isStep = mins.every((v, i) => v === i * step);
      if (isStep && 60 % step === 0) {
        return `Every ${step} minutes`;
      }
    }
  }

  // Specific time every day
  if (allDoms && allMonths && allDows && parsed.hour.values.length === 1 && parsed.minute.values.length === 1) {
    return `Every day at ${formatTime(parsed.hour.values[0], parsed.minute.values[0])}`;
  }

  // Specific time on specific day of week
  if (allDoms && allMonths && parsed.dayOfWeek.values.length === 1 && parsed.hour.values.length === 1 && parsed.minute.values.length === 1) {
    const day = DAY_NAMES[parsed.dayOfWeek.values[0]];
    return `Every ${day} at ${formatTime(parsed.hour.values[0], parsed.minute.values[0])}`;
  }

  // Specific time on specific days of week
  if (allDoms && allMonths && !allDows && parsed.hour.values.length === 1 && parsed.minute.values.length === 1) {
    const days = sortDowForDisplay(parsed.dayOfWeek.values).map((d) => DAY_NAMES[d]).join(", ");
    return `Every ${days} at ${formatTime(parsed.hour.values[0], parsed.minute.values[0])}`;
  }

  // Specific time on specific day of month
  if (allMonths && allDows && parsed.dayOfMonth.values.length === 1 && parsed.hour.values.length === 1 && parsed.minute.values.length === 1) {
    const dom = parsed.dayOfMonth.values[0];
    const suffix = getOrdinalSuffix(dom);
    return `Every month on the ${dom}${suffix} at ${formatTime(parsed.hour.values[0], parsed.minute.values[0])}`;
  }

  // Specific time on specific month and day
  if (allDows && parsed.month.values.length === 1 && parsed.dayOfMonth.values.length === 1 && parsed.hour.values.length === 1 && parsed.minute.values.length === 1) {
    const monthName = MONTH_NAMES[parsed.month.values[0]];
    const dom = parsed.dayOfMonth.values[0];
    const suffix = getOrdinalSuffix(dom);
    return `Every year on ${monthName} ${dom}${suffix} at ${formatTime(parsed.hour.values[0], parsed.minute.values[0])}`;
  }

  // Fallback: generic description
  return buildGenericDescription(parsed);
}

function getOrdinalSuffix(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  if (mod10 === 1) return "st";
  if (mod10 === 2) return "nd";
  if (mod10 === 3) return "rd";
  return "th";
}

/**
 * Sort day-of-week values for human-readable display.
 * Weekday order: Mon(1)–Sat(6), then Sun(0) at the end.
 * This ensures "5-7" (Fri, Sat, Sun) renders in natural order
 * rather than "Sunday, Friday, Saturday".
 */
function sortDowForDisplay(values: number[]): number[] {
  return [...values].sort((a, b) => {
    // Map 0 (Sunday) to 7 for sorting so it comes after Saturday
    const aKey = a === 0 ? 7 : a;
    const bKey = b === 0 ? 7 : b;
    return aKey - bKey;
  });
}

function buildGenericDescription(parsed: ParsedCron): string {
  const parts: string[] = [];

  if (parsed.minute.values.length === 60) {
    parts.push("Every minute");
  } else {
    parts.push(`At minute ${parsed.minute.values.join(", ")}`);
  }

  if (parsed.hour.values.length < 24) {
    parts.push(`past hour ${parsed.hour.values.join(", ")}`);
  }

  if (parsed.dayOfMonth.values.length < 31) {
    parts.push(`on day ${parsed.dayOfMonth.values.join(", ")} of the month`);
  }

  if (parsed.month.values.length < 12) {
    const months = parsed.month.values.map((m) => MONTH_NAMES[m]);
    parts.push(`in ${months.join(", ")}`);
  }

  if (parsed.dayOfWeek.values.length < 7) {
    const days = sortDowForDisplay(parsed.dayOfWeek.values).map((d) => DAY_NAMES[d]);
    parts.push(`on ${days.join(", ")}`);
  }

  return parts.join(" ");
}

/**
 * Computes the next run time for a cron expression.
 * @param expr - A 5-field cron expression or named shortcut
 * @param now - Optional reference time (defaults to Date.now())
 * @returns The next Date when the cron job would fire
 */
export function getNextCronRun(expr: string, now?: Date): Date {
  const lower = expr.trim().toLowerCase();
  if (lower === "@reboot") {
    throw new Error("Cannot compute next run for @reboot");
  }

  const parsed = parseCronFields(expr);
  return computeNextRun(parsed, now ?? new Date());
}

/**
 * Parses a cron expression and returns the next run time and a
 * human-readable interval description.
 * @param expr - A 5-field cron expression or named shortcut
 * @param now - Optional reference time (defaults to Date.now())
 */
export function parseCronExpression(
  expr: string,
  now?: Date
): { nextRun: Date | undefined; interval: string } {
  const interval = describeCronExpression(expr);

  if (expr.trim().toLowerCase() === "@reboot") {
    return { nextRun: undefined, interval };
  }

  const nextRun = getNextCronRun(expr, now);
  return { nextRun, interval };
}
