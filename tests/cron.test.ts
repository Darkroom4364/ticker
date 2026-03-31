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

  it("handles day 15 of specific month", () => {
    // Dec 25 at noon
    const result = parseCronExpression("0 12 25 12 *", NOW);
    expect(result.nextRun.getMonth()).toBe(11); // December
    expect(result.nextRun.getDate()).toBe(25);
    expect(result.nextRun.getHours()).toBe(12);
  });
});
