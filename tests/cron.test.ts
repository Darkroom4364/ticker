import { describe, it, expect } from "vitest";
import {
  parseCronExpression,
  describeCronExpression,
  getNextCronRun,
} from "../src/utils/cron.js";

// Fixed reference time: 2025-06-15 10:30:00 (Sunday)
const NOW = new Date(2025, 5, 15, 10, 30, 0);

describe("describeCronExpression", () => {
  it("describes daily at specific time", () => {
    expect(describeCronExpression("0 2 * * *")).toBe("Every day at 2 AM");
  });

  it("describes daily at time with minutes", () => {
    expect(describeCronExpression("30 2 * * *")).toBe("Every day at 2:30 AM");
  });

  it("describes hourly", () => {
    expect(describeCronExpression("0 * * * *")).toBe("Every hour");
  });

  it("describes every minute", () => {
    expect(describeCronExpression("* * * * *")).toBe("Every minute");
  });

  it("describes every N minutes", () => {
    expect(describeCronExpression("*/15 * * * *")).toBe("Every 15 minutes");
  });

  it("describes weekly on specific day", () => {
    expect(describeCronExpression("0 9 * * 1")).toBe("Every Monday at 9 AM");
  });

  it("describes monthly on specific day", () => {
    expect(describeCronExpression("0 0 1 * *")).toBe(
      "Every month on the 1st at 12 AM"
    );
  });

  it("describes yearly", () => {
    expect(describeCronExpression("0 0 1 1 *")).toBe(
      "Every year on January 1st at 12 AM"
    );
  });

  it("describes multiple days of week", () => {
    expect(describeCronExpression("0 9 * * 1,3,5")).toBe(
      "Every Monday, Wednesday, Friday at 9 AM"
    );
  });

  describe("named shortcuts", () => {
    it("@daily", () => {
      expect(describeCronExpression("@daily")).toBe("Every day at 12 AM");
    });

    it("@hourly", () => {
      expect(describeCronExpression("@hourly")).toBe("Every hour");
    });

    it("@weekly", () => {
      expect(describeCronExpression("@weekly")).toBe("Every Sunday at 12 AM");
    });

    it("@monthly", () => {
      expect(describeCronExpression("@monthly")).toBe(
        "Every month on the 1st at 12 AM"
      );
    });

    it("@yearly", () => {
      expect(describeCronExpression("@yearly")).toBe(
        "Every year on January 1st at 12 AM"
      );
    });

    it("@annually", () => {
      expect(describeCronExpression("@annually")).toBe(
        "Every year on January 1st at 12 AM"
      );
    });

    it("@reboot", () => {
      expect(describeCronExpression("@reboot")).toBe("At system reboot");
    });
  });
});

describe("getNextCronRun", () => {
  it("returns a future Date", () => {
    const next = getNextCronRun("* * * * *", NOW);
    expect(next).toBeInstanceOf(Date);
    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("computes next run for daily at 2 AM", () => {
    // NOW is 10:30 AM, so next 2 AM is tomorrow
    const next = getNextCronRun("0 2 * * *", NOW);
    expect(next.getDate()).toBe(16);
    expect(next.getHours()).toBe(2);
    expect(next.getMinutes()).toBe(0);
  });

  it("computes next run for every 15 minutes", () => {
    // NOW is 10:30, next is 10:45
    const next = getNextCronRun("*/15 * * * *", NOW);
    expect(next.getHours()).toBe(10);
    expect(next.getMinutes()).toBe(45);
  });

  it("computes next run for specific day of week", () => {
    // NOW is Sunday (0). Next Monday (1) is June 16
    const next = getNextCronRun("0 9 * * 1", NOW);
    expect(next.getDate()).toBe(16);
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getHours()).toBe(9);
  });

  it("computes next run for monthly on the 1st", () => {
    // NOW is June 15, next 1st is July 1
    const next = getNextCronRun("0 0 1 * *", NOW);
    expect(next.getMonth()).toBe(6); // July (0-based)
    expect(next.getDate()).toBe(1);
  });

  it("computes next run for yearly", () => {
    // NOW is June 15 2025, next Jan 1 is 2026
    const next = getNextCronRun("0 0 1 1 *", NOW);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(1);
  });

  it("throws for @reboot", () => {
    expect(() => getNextCronRun("@reboot")).toThrow(
      "Cannot compute next run for @reboot"
    );
  });

  it("works with @daily shortcut", () => {
    const next = getNextCronRun("@daily", NOW);
    // Next midnight after 10:30 AM is tomorrow at 00:00
    expect(next.getDate()).toBe(16);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
  });
});

describe("parseCronExpression", () => {
  it("returns nextRun and interval", () => {
    const result = parseCronExpression("0 2 * * *", NOW);
    expect(result.nextRun).toBeInstanceOf(Date);
    expect(result.nextRun.getTime()).toBeGreaterThan(NOW.getTime());
    expect(result.interval).toBe("Every day at 2 AM");
  });

  it("works with step values", () => {
    const result = parseCronExpression("*/5 * * * *", NOW);
    expect(result.interval).toBe("Every 5 minutes");
    expect(result.nextRun.getMinutes() % 5).toBe(0);
  });

  it("works with named shortcuts", () => {
    const result = parseCronExpression("@hourly", NOW);
    expect(result.interval).toBe("Every hour");
  });
});

describe("POSIX day-of-month OR day-of-week semantics", () => {
  it("uses OR logic when both dom and dow are restricted", () => {
    // '0 0 15 * 1' = midnight on the 15th OR any Monday
    // NOW is 2025-06-15 (Sunday). Next match should be 2025-06-16 (Monday),
    // NOT the next date that is both the 15th AND a Monday.
    const next = getNextCronRun("0 0 15 * 1", NOW);
    // Should be Monday June 16, 2025 at midnight
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getDate()).toBe(16);
    expect(next.getMonth()).toBe(5); // June
    expect(next.getHours()).toBe(0);
  });

  it("fires on the 15th even if it is not a Monday (OR logic)", () => {
    // From a date before July 15, the 15th should match regardless of dow
    const beforeJuly15 = new Date(2025, 6, 14, 12, 0, 0); // July 14 2025 (Monday)
    const next = getNextCronRun("0 0 15 * 1", beforeJuly15);
    // July 15 2025 is a Tuesday — should still fire because dom=15 matches
    expect(next.getDate()).toBe(15);
    expect(next.getMonth()).toBe(6); // July
  });

  it("uses AND logic when only dom is restricted (dow is wildcard)", () => {
    // '0 0 15 * *' = midnight on the 15th of every month
    const next = getNextCronRun("0 0 15 * *", NOW);
    expect(next.getDate()).toBe(15);
    expect(next.getMonth()).toBe(6); // July (June 15 is today, so next is July 15)
  });

  it("uses AND logic when only dow is restricted (dom is wildcard)", () => {
    // '0 9 * * 1' = 9 AM every Monday
    const next = getNextCronRun("0 9 * * 1", NOW);
    expect(next.getDay()).toBe(1); // Monday
  });
});

describe("@reboot handling", () => {
  it("parseCronExpression returns undefined nextRun for @reboot", () => {
    const result = parseCronExpression("@reboot");
    expect(result.nextRun).toBeUndefined();
    expect(result.interval).toBe("At system reboot");
  });

  it("getNextCronRun still throws for @reboot", () => {
    expect(() => getNextCronRun("@reboot")).toThrow(
      "Cannot compute next run for @reboot"
    );
  });

  it("describeCronExpression handles @reboot", () => {
    expect(describeCronExpression("@reboot")).toBe("At system reboot");
  });
});

describe("Sunday = 7 convention", () => {
  it("accepts 7 as Sunday and normalizes to 0", () => {
    const next = getNextCronRun("0 0 * * 7", NOW);
    expect(next.getDay()).toBe(0); // Sunday
  });

  it("treats 0 and 7 identically for Sunday", () => {
    const nextWith0 = getNextCronRun("0 9 * * 0", NOW);
    const nextWith7 = getNextCronRun("0 9 * * 7", NOW);
    expect(nextWith0.getTime()).toBe(nextWith7.getTime());
  });

  it("handles ranges including 7 with correct weekday ordering", () => {
    // 5-7 should mean Friday, Saturday, Sunday — in that order
    const result = describeCronExpression("0 9 * * 5-7");
    expect(result).toBe("Every Friday, Saturday, Sunday at 9 AM");
  });

  it("handles mixed 0 and 7 in lists (deduplicates Sunday)", () => {
    // 0,7 both mean Sunday — should produce one Sunday, not two
    const result = describeCronExpression("0 9 * * 0,7");
    expect(result).toBe("Every Sunday at 9 AM");
  });
});

describe("edge cases", () => {
  it("handles ranges", () => {
    const result = parseCronExpression("0 9 * * 1-5", NOW);
    expect(result.interval).toBe(
      "Every Monday, Tuesday, Wednesday, Thursday, Friday at 9 AM"
    );
  });

  it("handles lists", () => {
    const result = parseCronExpression("0 9 * * 1,3,5", NOW);
    expect(result.interval).toBe(
      "Every Monday, Wednesday, Friday at 9 AM"
    );
  });

  it("handles step values with range", () => {
    // Every 2 hours from 8 to 16
    const result = parseCronExpression("0 8-16/2 * * *", NOW);
    expect(result.nextRun).toBeInstanceOf(Date);
    expect([8, 10, 12, 14, 16]).toContain(result.nextRun.getHours());
  });

  it("rejects invalid expressions — wrong field count", () => {
    expect(() => parseCronExpression("* * *")).toThrow(
      /expected 5 fields/i
    );
  });

  it("rejects invalid expressions — out of range value", () => {
    expect(() => parseCronExpression("60 * * * *")).toThrow();
  });

  it("rejects invalid expressions — bad range", () => {
    expect(() => parseCronExpression("* 25 * * *")).toThrow();
  });

  it("rejects step value of 0", () => {
    expect(() => parseCronExpression("*/0 * * * *")).toThrow(/Invalid step/);
  });

  it("rejects reversed range (start > end)", () => {
    expect(() => parseCronExpression("* * * * 5-1")).toThrow(/Invalid range/);
  });

  it("handles February 29 / leap year", () => {
    // From Jan 1 2024 (leap year), next Feb 29 should be 2024
    const jan2024 = new Date(2024, 0, 1, 0, 0, 0);
    const next = getNextCronRun("0 0 29 2 *", jan2024);
    expect(next.getFullYear()).toBe(2024);
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(29);
  });

  it("skips to next leap year for Feb 29 from non-leap year", () => {
    // From March 2025 (not a leap year), next Feb 29 is 2028
    const mar2025 = new Date(2025, 2, 1, 0, 0, 0);
    const next = getNextCronRun("0 0 29 2 *", mar2025);
    expect(next.getFullYear()).toBe(2028);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(29);
  });

  it("produces generic description for complex expressions", () => {
    // Multiple values in minute and hour — falls through to buildGenericDescription
    const result = describeCronExpression("0,30 2,14 * * *");
    expect(result).toContain("minute");
    expect(result).toContain("hour");
  });

  it("ordinal suffixes: 2nd, 3rd, 11th, 12th, 13th, 21st, 22nd, 23rd", () => {
    expect(describeCronExpression("0 0 2 * *")).toContain("2nd");
    expect(describeCronExpression("0 0 3 * *")).toContain("3rd");
    expect(describeCronExpression("0 0 11 * *")).toContain("11th");
    expect(describeCronExpression("0 0 12 * *")).toContain("12th");
    expect(describeCronExpression("0 0 13 * *")).toContain("13th");
    expect(describeCronExpression("0 0 21 * *")).toContain("21st");
    expect(describeCronExpression("0 0 22 * *")).toContain("22nd");
    expect(describeCronExpression("0 0 23 * *")).toContain("23rd");
  });

  it("formats PM times correctly", () => {
    expect(describeCronExpression("0 14 * * *")).toBe("Every day at 2 PM");
    expect(describeCronExpression("0 12 * * *")).toBe("Every day at 12 PM");
    expect(describeCronExpression("30 23 * * *")).toBe("Every day at 11:30 PM");
  });

  it("named shortcuts are case-insensitive", () => {
    expect(describeCronExpression("@Daily")).toBe("Every day at 12 AM");
    expect(describeCronExpression("@HOURLY")).toBe("Every hour");
  });

  it("handles day 15 of specific month", () => {
    // Dec 25 at noon
    const result = parseCronExpression("0 12 25 12 *", NOW);
    expect(result.nextRun.getMonth()).toBe(11); // December
    expect(result.nextRun.getDate()).toBe(25);
    expect(result.nextRun.getHours()).toBe(12);
  });
});
