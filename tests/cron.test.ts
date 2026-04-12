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

  it("rejects negative numbers", () => {
    expect(() => parseCronExpression("-1 * * * *")).toThrow();
  });

  it("rejects negative step values", () => {
    expect(() => parseCronExpression("*/-1 * * * *")).toThrow();
  });

  it("rejects non-numeric values", () => {
    expect(() => parseCronExpression("abc * * * *")).toThrow();
  });

  it("rejects malformed range with 3+ parts", () => {
    expect(() => parseCronExpression("0-5-10 * * * *")).toThrow(/Invalid range/);
  });

  it("rejects decimal values", () => {
    expect(() => parseCronExpression("1.5 * * * *")).toThrow();
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

describe("whitespace variations", () => {
  it("handles leading and trailing whitespace", () => {
    expect(describeCronExpression("  0 2 * * *  ")).toBe("Every day at 2 AM");
  });

  it("handles multiple spaces between fields", () => {
    expect(describeCronExpression("0  2  *  *  *")).toBe("Every day at 2 AM");
  });

  it("handles tabs between fields", () => {
    expect(describeCronExpression("0\t2\t*\t*\t*")).toBe("Every day at 2 AM");
  });

  it("handles mixed tabs and spaces", () => {
    expect(describeCronExpression("0 \t 2 \t * \t * \t *")).toBe(
      "Every day at 2 AM"
    );
  });

  it("rejects empty string", () => {
    expect(() => parseCronExpression("")).toThrow();
  });

  it("rejects string of only spaces", () => {
    expect(() => parseCronExpression("   ")).toThrow();
  });
});

describe("maximum field expansions", () => {
  it("parses full minute range 0-59", () => {
    const result = parseCronExpression("0-59 0 1 1 *", NOW);
    expect(result.interval).toContain("minute");
  });

  it("parses full hour range 0-23", () => {
    const result = parseCronExpression("0 0-23 1 1 *", NOW);
    expect(result.nextRun).toBeInstanceOf(Date);
  });

  it("parses full day-of-month range 1-31", () => {
    const result = parseCronExpression("0 0 1-31 1 *", NOW);
    expect(result.nextRun).toBeInstanceOf(Date);
  });

  it("parses full month range 1-12", () => {
    const result = parseCronExpression("0 0 1 1-12 *", NOW);
    expect(result.nextRun).toBeInstanceOf(Date);
  });

  it("parses full day-of-week range 0-6", () => {
    const result = parseCronExpression("0 0 * * 0-6", NOW);
    expect(result.nextRun).toBeInstanceOf(Date);
  });
});

describe("overlapping ranges and duplicates", () => {
  it("handles overlapping ranges in a field: 1-5,3-7", () => {
    // Should deduplicate and produce 1,2,3,4,5,6,7
    const result = parseCronExpression("0 1-5,3-7 * * *", NOW);
    expect(result.nextRun).toBeInstanceOf(Date);
    // The hour should be in the merged range
    expect(result.nextRun.getHours()).toBeGreaterThanOrEqual(1);
    expect(result.nextRun.getHours()).toBeLessThanOrEqual(7);
  });

  it("handles duplicate values: 1,1,1,1", () => {
    const result = parseCronExpression("0 1,1,1,1 * * *", NOW);
    expect(result.nextRun.getHours()).toBe(1);
  });

  it("handles overlapping ranges in minutes: 0-30,15-45", () => {
    const result = parseCronExpression("0-30,15-45 12 * * *", NOW);
    expect(result.nextRun).toBeInstanceOf(Date);
  });
});

describe("step edge cases", () => {
  it("step on single value: 5/2 in minutes", () => {
    // parseField treats '5' as a single value, step=2, but since it's not a range or *,
    // '5' is parsed as a literal numeric value — this depends on implementation
    // The regex matches 5/2: range='5', step=2, but '5' is a single number not containing '-'
    // and not '*', so it adds just the value 5.
    const result = parseCronExpression("5/2 * * * *", NOW);
    expect(result.nextRun).toBeInstanceOf(Date);
  });

  it("step larger than range: */100 in minutes", () => {
    // Only minute 0 will match (0 is first, 0+100>59 so no more)
    const result = parseCronExpression("*/100 * * * *", NOW);
    expect(result.nextRun.getMinutes()).toBe(0);
  });

  it("step larger than range: */25 in hours", () => {
    // Only hour 0 matches (0+25>23)
    const result = parseCronExpression("0 */25 * * *", NOW);
    expect(result.nextRun.getHours()).toBe(0);
  });

  it("step of 1 is same as no step", () => {
    const a = describeCronExpression("*/1 * * * *");
    const b = describeCronExpression("* * * * *");
    expect(a).toBe(b);
  });
});

describe("boundary values", () => {
  it("minute=59", () => {
    const result = parseCronExpression("59 * * * *", NOW);
    expect(result.nextRun.getMinutes()).toBe(59);
  });

  it("hour=23", () => {
    const result = parseCronExpression("0 23 * * *", NOW);
    expect(result.nextRun.getHours()).toBe(23);
  });

  it("day-of-month=31", () => {
    const result = parseCronExpression("0 0 31 * *", NOW);
    expect(result.nextRun.getDate()).toBe(31);
  });

  it("month=12", () => {
    const result = parseCronExpression("0 0 1 12 *", NOW);
    expect(result.nextRun.getMonth()).toBe(11); // December, 0-based
  });

  it("day-of-week=6 (Saturday)", () => {
    const result = parseCronExpression("0 0 * * 6", NOW);
    expect(result.nextRun.getDay()).toBe(6);
  });
});

describe("all wildcards vs all specific", () => {
  it("all wildcards: * * * * * fires next minute", () => {
    const next = getNextCronRun("* * * * *", NOW);
    expect(next.getTime() - NOW.getTime()).toBeLessThanOrEqual(60000);
    expect(next.getMinutes()).toBe(31);
  });

  it("all specific: 30 14 15 6 3 fires on exact match", () => {
    // June 15 2025 is a Sunday (day 0), not Wednesday (3).
    // Both dom=15 and dow=3 are restricted, so OR logic applies.
    // June 15 matches dom=15, so it should fire at 14:30 today.
    const next = getNextCronRun("30 14 15 6 3", NOW);
    expect(next.getMonth()).toBe(5); // June
    expect(next.getHours()).toBe(14);
    expect(next.getMinutes()).toBe(30);
  });
});

describe("invalid field counts", () => {
  it("rejects 6 fields", () => {
    expect(() => parseCronExpression("0 0 1 1 * *")).toThrow(
      /expected 5 fields/i
    );
  });

  it("rejects 4 fields", () => {
    expect(() => parseCronExpression("0 0 1 *")).toThrow(
      /expected 5 fields/i
    );
  });

  it("rejects 1 field", () => {
    expect(() => parseCronExpression("0")).toThrow(/expected 5 fields/i);
  });

  it("rejects 2 fields", () => {
    expect(() => parseCronExpression("0 0")).toThrow(/expected 5 fields/i);
  });
});

describe("extremely large and out-of-range values", () => {
  it("rejects minute=999", () => {
    expect(() => parseCronExpression("999 * * * *")).toThrow();
  });

  it("rejects hour=99", () => {
    expect(() => parseCronExpression("0 99 * * *")).toThrow();
  });

  it("rejects day-of-month=32", () => {
    expect(() => parseCronExpression("0 0 32 * *")).toThrow();
  });

  it("rejects month=13", () => {
    expect(() => parseCronExpression("0 0 1 13 *")).toThrow();
  });

  it("rejects day-of-week=8", () => {
    expect(() => parseCronExpression("0 0 * * 8")).toThrow();
  });

  it("rejects day-of-month=0", () => {
    expect(() => parseCronExpression("0 0 0 * *")).toThrow();
  });

  it("rejects month=0", () => {
    expect(() => parseCronExpression("0 0 1 0 *")).toThrow();
  });
});

describe("negative numbers in various fields", () => {
  it("rejects negative minute", () => {
    expect(() => parseCronExpression("-5 * * * *")).toThrow();
  });

  it("rejects negative hour", () => {
    expect(() => parseCronExpression("0 -1 * * *")).toThrow();
  });

  it("rejects negative day-of-month", () => {
    expect(() => parseCronExpression("0 0 -1 * *")).toThrow();
  });

  it("rejects negative in range start", () => {
    expect(() => parseCronExpression("-1-5 * * * *")).toThrow();
  });
});

describe("unicode and special characters", () => {
  it("rejects unicode characters in expression", () => {
    expect(() => parseCronExpression("0 0 * * \u{1F600}")).toThrow();
  });

  it("rejects emoji in field", () => {
    expect(() => parseCronExpression("\u{1F4A9} * * * *")).toThrow();
  });

  it("rejects special characters like @unknown", () => {
    expect(() => parseCronExpression("@unknown")).toThrow();
  });

  it("rejects expression with semicolons", () => {
    expect(() => parseCronExpression("0;0 * * * *")).toThrow();
  });
});

describe("null and undefined input handling", () => {
  it("throws on null input to parseCronExpression", () => {
    expect(() =>
      parseCronExpression(null as unknown as string)
    ).toThrow();
  });

  it("throws on undefined input to parseCronExpression", () => {
    expect(() =>
      parseCronExpression(undefined as unknown as string)
    ).toThrow();
  });

  it("throws on null input to describeCronExpression", () => {
    expect(() =>
      describeCronExpression(null as unknown as string)
    ).toThrow();
  });

  it("throws on undefined input to getNextCronRun", () => {
    expect(() =>
      getNextCronRun(undefined as unknown as string)
    ).toThrow();
  });
});

describe("nextRun near midnight boundaries", () => {
  it("rolls from 23:59 to 00:00 next day", () => {
    const nearMidnight = new Date(2025, 5, 15, 23, 59, 0);
    const next = getNextCronRun("0 0 * * *", nearMidnight);
    expect(next.getDate()).toBe(16);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
  });

  it("fires at 23:59 when scheduled", () => {
    const before = new Date(2025, 5, 15, 23, 58, 0);
    const next = getNextCronRun("59 23 * * *", before);
    expect(next.getDate()).toBe(15);
    expect(next.getHours()).toBe(23);
    expect(next.getMinutes()).toBe(59);
  });

  it("every minute at 23:59 rolls to next day 00:00", () => {
    const at2359 = new Date(2025, 5, 15, 23, 59, 0);
    const next = getNextCronRun("* * * * *", at2359);
    expect(next.getDate()).toBe(16);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
  });
});

describe("nextRun near month boundaries", () => {
  it("rolls from Jan 31 to Feb 1 for daily cron", () => {
    const jan31 = new Date(2025, 0, 31, 23, 59, 0);
    const next = getNextCronRun("0 0 * * *", jan31);
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(1);
  });

  it("rolls from Apr 30 to May 1", () => {
    const apr30 = new Date(2025, 3, 30, 23, 59, 0);
    const next = getNextCronRun("0 0 * * *", apr30);
    expect(next.getMonth()).toBe(4); // May
    expect(next.getDate()).toBe(1);
  });

  it("handles day 31 skipping months without 31 days", () => {
    // Feb, Apr, Jun, Sep, Nov don't have 31 days
    const jan31 = new Date(2025, 0, 31, 0, 0, 0);
    const next = getNextCronRun("0 0 31 * *", jan31);
    // Next month with day 31 after Jan is March
    expect(next.getMonth()).toBe(2); // March
    expect(next.getDate()).toBe(31);
  });
});

describe("nextRun near year boundaries", () => {
  it("rolls from Dec 31 to Jan 1 next year", () => {
    const dec31 = new Date(2025, 11, 31, 23, 59, 0);
    const next = getNextCronRun("0 0 * * *", dec31);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(0); // January
    expect(next.getDate()).toBe(1);
  });

  it("yearly cron at Dec 31 rolls to next year", () => {
    const dec31 = new Date(2025, 11, 31, 12, 0, 0);
    const next = getNextCronRun("0 0 1 1 *", dec31);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(1);
  });
});

describe("leap year Feb 29 cron", () => {
  it("fires once a year only on leap years: 0 0 29 2 *", () => {
    const jan2025 = new Date(2025, 0, 1, 0, 0, 0);
    const next = getNextCronRun("0 0 29 2 *", jan2025);
    // 2025 is not a leap year, 2026 no, 2027 no, 2028 yes
    expect(next.getFullYear()).toBe(2028);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(29);
  });

  it("fires in current leap year if not yet past", () => {
    const feb1_2028 = new Date(2028, 1, 1, 0, 0, 0);
    const next = getNextCronRun("0 0 29 2 *", feb1_2028);
    expect(next.getFullYear()).toBe(2028);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(29);
  });
});

describe("getDescription for complex expressions", () => {
  it("describes complex multi-field expression", () => {
    const desc = describeCronExpression("5,10,15 2,14 1,15 6,12 *");
    expect(desc).toContain("minute");
    expect(desc).toContain("5");
    expect(desc).toContain("10");
    expect(desc).toContain("15");
  });

  it("describes expression with restricted months", () => {
    const desc = describeCronExpression("0 0 * 1,6 *");
    expect(desc).toContain("January");
    expect(desc).toContain("June");
  });

  it("describes expression with all fields restricted", () => {
    const desc = describeCronExpression("30 14 15 6 3");
    expect(desc).toContain("minute");
    expect(desc).toContain("Wednesday");
  });

  it("describes expression with step in day-of-week", () => {
    const desc = describeCronExpression("0 0 * * 1-5");
    expect(desc).toContain("Monday");
    expect(desc).toContain("Friday");
  });
});

describe("named shortcut edge cases", () => {
  it("@midnight is identical to @daily", () => {
    expect(describeCronExpression("@midnight")).toBe(
      describeCronExpression("@daily")
    );
  });

  it("@annually is identical to @yearly", () => {
    expect(describeCronExpression("@annually")).toBe(
      describeCronExpression("@yearly")
    );
  });

  it("@daily nextRun matches 0 0 * * * nextRun", () => {
    const a = getNextCronRun("@daily", NOW);
    const b = getNextCronRun("0 0 * * *", NOW);
    expect(a.getTime()).toBe(b.getTime());
  });

  it("@weekly nextRun matches 0 0 * * 0 nextRun", () => {
    const a = getNextCronRun("@weekly", NOW);
    const b = getNextCronRun("0 0 * * 0", NOW);
    expect(a.getTime()).toBe(b.getTime());
  });
});
