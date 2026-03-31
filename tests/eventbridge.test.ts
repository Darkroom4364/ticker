import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanOptions } from "../src/types.js";
import { EventBridgeScanner } from "../src/scanners/eventbridge.js";
import {
  EventBridgeClient,
  ListRulesCommand,
} from "@aws-sdk/client-eventbridge";

function createMockClient(
  responses: Array<{
    Rules?: Array<{
      Name?: string;
      Arn?: string;
      ScheduleExpression?: string;
      EventBusName?: string;
      State?: string;
    }>;
    NextToken?: string;
  }>,
  error?: Error
): EventBridgeClient {
  const client = {
    send: vi.fn(),
  } as unknown as EventBridgeClient;

  const sendMock = vi.mocked(client.send);

  if (error) {
    sendMock.mockRejectedValue(error);
  } else {
    for (const response of responses) {
      sendMock.mockResolvedValueOnce(response as never);
    }
  }

  return client;
}

const defaultOptions: ScanOptions = {};

describe("EventBridgeScanner", () => {
  let scanner: EventBridgeScanner;

  describe("name", () => {
    it("should be 'eventbridge'", () => {
      const client = createMockClient([]);
      scanner = new EventBridgeScanner(client);
      expect(scanner.name).toBe("eventbridge");
    });
  });

  describe("isAvailable", () => {
    it("returns true when AWS credentials are valid", async () => {
      const client = createMockClient([{ Rules: [] }]);
      scanner = new EventBridgeScanner(client);
      expect(await scanner.isAvailable()).toBe(true);
    });

    it("returns false when AWS credentials are missing", async () => {
      const client = createMockClient([], new Error("Missing credentials"));
      scanner = new EventBridgeScanner(client);
      expect(await scanner.isAvailable()).toBe(false);
    });
  });

  describe("scan", () => {
    it("parses cron schedule expressions", async () => {
      const client = createMockClient([
        {
          Rules: [
            {
              Name: "daily-etl",
              Arn: "arn:aws:events:us-east-1:123456:rule/daily-etl",
              ScheduleExpression: "cron(0 2 * * ? *)",
              EventBusName: "default",
              State: "ENABLED",
            },
          ],
        },
      ]);
      scanner = new EventBridgeScanner(client);

      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("daily-etl");
      expect(tasks[0].schedule).toBe("cron(0 2 * * ? *)");
      expect(tasks[0].source).toBe("eventbridge");
      expect(tasks[0].nextRun).toBeInstanceOf(Date);
      expect(tasks[0].interval).toBe("Every day at 2 AM");
      expect(tasks[0].metadata?.arn).toBe(
        "arn:aws:events:us-east-1:123456:rule/daily-etl"
      );
      expect(tasks[0].metadata?.eventBus).toBe("default");
      expect(tasks[0].metadata?.state).toBe("ENABLED");
    });

    it("parses rate schedule expressions", async () => {
      const client = createMockClient([
        {
          Rules: [
            {
              Name: "health-check",
              Arn: "arn:aws:events:us-east-1:123456:rule/health-check",
              ScheduleExpression: "rate(5 minutes)",
              EventBusName: "default",
              State: "ENABLED",
            },
          ],
        },
      ]);
      scanner = new EventBridgeScanner(client);

      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("health-check");
      expect(tasks[0].schedule).toBe("rate(5 minutes)");
      expect(tasks[0].interval).toBe("Every 5 minutes");
      expect(tasks[0].nextRun).toBeInstanceOf(Date);
    });

    it("parses rate expression with singular unit", async () => {
      const client = createMockClient([
        {
          Rules: [
            {
              Name: "daily-task",
              Arn: "arn:aws:events:us-east-1:123456:rule/daily-task",
              ScheduleExpression: "rate(1 day)",
              EventBusName: "default",
              State: "ENABLED",
            },
          ],
        },
      ]);
      scanner = new EventBridgeScanner(client);

      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].interval).toBe("Every day");
    });

    it("handles multiple rules across pages", async () => {
      const client = createMockClient([
        {
          Rules: [
            {
              Name: "rule-1",
              ScheduleExpression: "rate(1 hour)",
              EventBusName: "default",
            },
          ],
          NextToken: "page2",
        },
        {
          Rules: [
            {
              Name: "rule-2",
              ScheduleExpression: "rate(1 day)",
              EventBusName: "default",
            },
          ],
        },
      ]);
      scanner = new EventBridgeScanner(client);

      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(2);
      expect(tasks[0].name).toBe("rule-1");
      expect(tasks[1].name).toBe("rule-2");
    });

    it("skips rules without ScheduleExpression", async () => {
      const client = createMockClient([
        {
          Rules: [
            {
              Name: "event-pattern-rule",
              Arn: "arn:aws:events:us-east-1:123456:rule/event-pattern-rule",
              EventBusName: "default",
              State: "ENABLED",
              // No ScheduleExpression — this is an event-pattern rule
            },
            {
              Name: "scheduled-rule",
              Arn: "arn:aws:events:us-east-1:123456:rule/scheduled-rule",
              ScheduleExpression: "rate(1 hour)",
              EventBusName: "default",
              State: "ENABLED",
            },
          ],
        },
      ]);
      scanner = new EventBridgeScanner(client);

      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("scheduled-rule");
    });

    it("returns empty array on AWS API error", async () => {
      const client = createMockClient(
        [],
        new Error("UnrecognizedClientException")
      );
      scanner = new EventBridgeScanner(client);

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("returns empty array when no rules exist", async () => {
      const client = createMockClient([{ Rules: [] }]);
      scanner = new EventBridgeScanner(client);

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks).toHaveLength(0);
    });

    it("converts AWS 6-field cron to standard 5-field with ? replacement", async () => {
      // AWS uses '?' for day-of-week when day-of-month is set
      const client = createMockClient([
        {
          Rules: [
            {
              Name: "monthly-report",
              ScheduleExpression: "cron(0 9 1 * ? *)",
              EventBusName: "default",
            },
          ],
        },
      ]);
      scanner = new EventBridgeScanner(client);

      const tasks = await scanner.scan(defaultOptions);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].interval).toBe("Every month on the 1st at 9 AM");
    });

    it("sets source to 'eventbridge' for all tasks", async () => {
      const client = createMockClient([
        {
          Rules: [
            {
              Name: "r1",
              ScheduleExpression: "rate(1 hour)",
              EventBusName: "default",
            },
            {
              Name: "r2",
              ScheduleExpression: "cron(0 0 * * ? *)",
              EventBusName: "custom-bus",
            },
          ],
        },
      ]);
      scanner = new EventBridgeScanner(client);

      const tasks = await scanner.scan(defaultOptions);
      for (const task of tasks) {
        expect(task.source).toBe("eventbridge");
      }
    });

    it("uses 'unnamed-rule' when Name is missing", async () => {
      const client = createMockClient([
        {
          Rules: [
            {
              ScheduleExpression: "rate(1 hour)",
              EventBusName: "default",
            },
          ],
        },
      ]);
      scanner = new EventBridgeScanner(client);

      const tasks = await scanner.scan(defaultOptions);
      expect(tasks[0].name).toBe("unnamed-rule");
    });
  });
});
