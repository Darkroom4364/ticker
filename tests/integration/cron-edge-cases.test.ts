import { describe, it, expect } from "vitest";
import {
  parseCronExpression,
  getNextCronRun,
} from "../../src/utils/cron.js";

/**
 * Comprehensive cron parser edge-case tests covering shortcuts,
 * day-of-week semantics, leap years, month boundaries, step values,
 * combined range+step, wildcards, and POSIX OR semantics.
 */

// Fixed reference time: 2025-06-15 10:30:00 (Sunday)
const NOW = new Date(2025, 5, 15, 10, 30, 0);

// ── @-shortcuts ────────────────────────────────────────────────────────

describe("All @-shortcuts produce valid nextRun dates", () => {
  const shortcuts = [
    "@yearly",
    "@annually",
    "@monthly",
    "@weekly",
    "@daily",
    "@midnight",
    "@hourly",
  ];

  for (const shortcut of shortcuts) {
    it(`${shortcut} produces a valid future Date`, () => {
      const result = parseCronExpression(shortcut, NOW);
      expect(result.nextRun).toBeInstanceOf(Date);
      expect((result.nextRun as Date).getTime()).toBeGreaterThan(
        NOW.getTime()
      );
    });

    it(`${shortcut} has a non-empty interval description`, () => {
      const result = parseCronExpression(shortcut, NOW);
      expect(typeof result.interval).toBe("string");
      expect(result.interval.length).toBeGreaterThan(0);
    });
  }
});

// ── Day-of-week: Sunday = 0 and 7 ─────────────────────────────────────

describe("Day-of-week Sunday = 0 and 7 both work", () => {
  it("DOW 0 resolves to Sunday", () => {
    const next = getNextCronRun("0 0 * * 0", NOW);
    expect(next.getDay()).toBe(0); // Sunday
  });

  it("DOW 7 resolves to Sunday", () => {
    const next = getNextCronRun("0 0 * * 7", NOW);
    expect(next.getDay()).toBe(0); // Sunday
  });

  it("DOW 0 and 7 produce the same nextRun", () => {
    const with0 = getNextCronRun("0 12 * * 0", NOW);
    const with7 = getNextCronRun("0 12 * * 7", NOW);
    expect(with0.getTime()).toBe(with7.getTime());
  });

  it("range 5-7 includes Friday, Saturday, Sunday", () => {
    // From Sunday 10:30, next match at midnight for 5-7 should be a Fri/Sat/Sun
    const next = getNextCronRun("0 0 * * 5-7", NOW);
    expect([0, 5, 6]).toContain(next.getDay());
  });
});

// ── Leap year: Feb 29 ──────────────────────────────────────────────────

describe("Leap year: Feb 29 schedule", () => {
  it("produces valid nextRun from a leap year start", () => {
    const jan2024 = new Date(2024, 0, 1, 0, 0, 0);
    const next = getNextCronRun("0 0 29 2 *", jan2024);
    expect(next).toBeInstanceOf(Date);
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(29);
    expect(next.getFullYear()).toBe(2024);
  });

  it("skips non-leap years and lands on next leap year", () => {
    const mar2025 = new Date(2025, 2, 1, 0, 0, 0);
    const next = getNextCronRun("0 0 29 2 *", mar2025);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(29);
    // 2026 and 2027 are not leap years; 2028 is
    expect(next.getFullYear()).toBe(2028);
  });

  it("Feb 29 nextRun is in the future relative to reference", () => {
    const next = getNextCronRun("0 0 29 2 *", NOW);
    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

// ── Month boundaries ───────────────────────────────────────────────────

describe("Month boundaries: day 31", () => {
  it('"0 0 31 * *" fires in months with 31 days', () => {
    // From June 15 (June has 30 days), next 31st is July 31
    const next = getNextCronRun("0 0 31 * *", NOW);
    expect(next.getDate()).toBe(31);
    // July (6), August (7), October (9), December (11), January (0), March (2), May (4)
    const monthsWith31 = [0, 2, 4, 6, 7, 9, 11];
    expect(monthsWith31).toContain(next.getMonth());
  });

  it('"0 0 31 * *" skips months with fewer than 31 days', () => {
    // From June 1 — June has 30 days, so should skip to July 31
    const june1 = new Date(2025, 5, 1, 0, 0, 0);
    const next = getNextCronRun("0 0 31 * *", june1);
    expect(next.getMonth()).toBe(6); // July
    expect(next.getDate()).toBe(31);
  });

  it('"0 0 30 * *" skips February', () => {
    // From Jan 31 2025, next 30th should be March 30 (Feb has no 30th)
    const jan31 = new Date(2025, 0, 31, 1, 0, 0);
    const next = getNextCronRun("0 0 30 * *", jan31);
    expect(next.getMonth()).toBe(2); // March
    expect(next.getDate()).toBe(30);
  });
});

// ── Step values across all fields ──────────────────────────────────────

describe("Step values across all fields", () => {
  it("minute step: */10 produces minutes divisible by 10", () => {
    const next = getNextCronRun("*/10 * * * *", NOW);
    expect(next.getMinutes() % 10).toBe(0);
  });

  it("hour step: 0 */4 * * * produces hours divisible by 4", () => {
    const next = getNextCronRun("0 */4 * * *", NOW);
    expect(next.getHours() % 4).toBe(0);
    expect(next.getMinutes()).toBe(0);
  });

  it("day-of-month step: 0 0 */5 * * produces day matching step pattern", () => {
    const next = getNextCronRun("0 0 */5 * *", NOW);
    // */5 from 1-31 => 1, 6, 11, 16, 21, 26, 31
    expect([1, 6, 11, 16, 21, 26, 31]).toContain(next.getDate());
  });

  it("month step: 0 0 1 */3 * produces months matching step pattern", () => {
    const next = getNextCronRun("0 0 1 */3 *", NOW);
    // */3 from 1-12 => 1, 4, 7, 10
    expect([0, 3, 6, 9]).toContain(next.getMonth()); // 0-based
  });

  it("day-of-week step: 0 0 * * */2 produces days matching step pattern", () => {
    const next = getNextCronRun("0 0 * * */2", NOW);
    // */2 from 0-7 => 0, 2, 4, 6 (with 7 normalized to 0)
    expect([0, 2, 4, 6]).toContain(next.getDay());
  });
});

// ── Combined range+step ────────────────────────────────────────────────

describe('Combined range+step: "0-30/5 * * * *"', () => {
  it("produces minutes in {0, 5, 10, 15, 20, 25, 30}", () => {
    const next = getNextCronRun("0-30/5 * * * *", NOW);
    expect([0, 5, 10, 15, 20, 25, 30]).toContain(next.getMinutes());
  });

  it("nextRun is in the future", () => {
    const next = getNextCronRun("0-30/5 * * * *", NOW);
    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("hour range+step: 8-18/2 produces even hours 8-18", () => {
    const next = getNextCronRun("0 8-18/2 * * *", NOW);
    expect([8, 10, 12, 14, 16, 18]).toContain(next.getHours());
  });
});

// ── Full wildcard ──────────────────────────────────────────────────────

describe('Full wildcard: "* * * * *" fires within next minute', () => {
  it("nextRun is within 60 seconds of now", () => {
    const realNow = new Date();
    const next = getNextCronRun("* * * * *", realNow);
    const diffMs = next.getTime() - realNow.getTime();
    // Should be within ~60 seconds (next minute boundary)
    expect(diffMs).toBeGreaterThan(0);
    expect(diffMs).toBeLessThanOrEqual(60_000);
  });

  it("nextRun is exactly 1 minute ahead (seconds zeroed)", () => {
    const next = getNextCronRun("* * * * *", NOW);
    expect(next.getMinutes()).toBe(31);
    expect(next.getSeconds()).toBe(0);
  });
});

// ── January 1st ────────────────────────────────────────────────────────

describe('"0 0 1 1 *" (Jan 1) produces a valid nextRun', () => {
  it("nextRun falls on January 1st", () => {
    const next = getNextCronRun("0 0 1 1 *", NOW);
    expect(next.getMonth()).toBe(0); // January
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
  });

  it("nextRun is in a future year relative to NOW", () => {
    const next = getNextCronRun("0 0 1 1 *", NOW);
    expect(next.getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it("nextRun is a valid Date", () => {
    const next = getNextCronRun("0 0 1 1 *", NOW);
    expect(next).toBeInstanceOf(Date);
    expect(isNaN(next.getTime())).toBe(false);
  });
});

// ── POSIX day-of-month OR day-of-week semantics ────────────────────────

describe("POSIX day-of-month OR day-of-week when both restricted", () => {
  it("fires on matching day-of-month even if day-of-week differs", () => {
    // "0 0 15 * 1" = midnight on the 15th OR any Monday
    // July 15 2025 is a Tuesday — should still fire because dom=15 matches
    const july14 = new Date(2025, 6, 14, 12, 0, 0);
    const next = getNextCronRun("0 0 15 * 1", july14);
    expect(next.getDate()).toBe(15);
    expect(next.getMonth()).toBe(6);
  });

  it("fires on matching day-of-week even if day-of-month differs", () => {
    // From Sunday June 15, next Monday is June 16 (dom != 15)
    const next = getNextCronRun("0 0 15 * 1", NOW);
    // Should be Monday June 16 (dow matches) before waiting for the 15th
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getDate()).toBe(16);
  });

  it("uses AND logic when only dom is restricted (dow is *)", () => {
    const next = getNextCronRun("0 0 20 * *", NOW);
    expect(next.getDate()).toBe(20);
  });

  it("uses AND logic when only dow is restricted (dom is *)", () => {
    const next = getNextCronRun("0 0 * * 3", NOW);
    expect(next.getDay()).toBe(3); // Wednesday
  });

  it("OR logic: both restricted, earliest match wins", () => {
    // "0 0 25 * 1" from June 15 (Sun)
    // Next Monday is June 16, next 25th is June 25
    // OR logic -> June 16 wins (earliest)
    const next = getNextCronRun("0 0 25 * 1", NOW);
    expect(next.getDate()).toBe(16);
    expect(next.getDay()).toBe(1);
  });
});

// ── Additional edge cases ──────────────────────────────────────────────

describe("Additional cron edge cases", () => {
  it("comma-separated values in minute field", () => {
    const next = getNextCronRun("0,15,30,45 * * * *", NOW);
    expect([0, 15, 30, 45]).toContain(next.getMinutes());
  });

  it("specific month and dom: Dec 25 at noon", () => {
    const next = getNextCronRun("0 12 25 12 *", NOW);
    expect(next.getMonth()).toBe(11); // December
    expect(next.getDate()).toBe(25);
    expect(next.getHours()).toBe(12);
  });

  it("last valid minute of day: 59 23 * * *", () => {
    const next = getNextCronRun("59 23 * * *", NOW);
    expect(next.getHours()).toBe(23);
    expect(next.getMinutes()).toBe(59);
  });

  it("first valid minute of day: 0 0 * * *", () => {
    const next = getNextCronRun("0 0 * * *", NOW);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
    // Should be tomorrow since NOW is 10:30
    expect(next.getDate()).toBe(16);
  });

  it("multiple ranges in single field: 1-5,10-15 in minute", () => {
    const next = getNextCronRun("1-5,10-15 * * * *", NOW);
    const min = next.getMinutes();
    expect(
      (min >= 1 && min <= 5) || (min >= 10 && min <= 15)
    ).toBe(true);
  });

  it("every minute of a specific hour: * 3 * * *", () => {
    const next = getNextCronRun("* 3 * * *", NOW);
    expect(next.getHours()).toBe(3);
    // Since NOW is 10:30, should be tomorrow at 3:00
    expect(next.getDate()).toBe(16);
    expect(next.getMinutes()).toBe(0);
  });
});
