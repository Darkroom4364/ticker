import { EventBridgeScanner } from './dist/scanners/eventbridge.js';

// Mock client
class MockEventBridgeClient {
  constructor(rules) {
    this.rules = rules;
  }
  
  send(command) {
    return Promise.resolve({ Rules: this.rules });
  }
}

const tests = [
  { value: 0, unit: "minutes", shouldFail: true },
  { value: 1, unit: "minutes", shouldFail: false },
  { value: 999999, unit: "minutes", shouldFail: false },
  { value: 1_000_000, unit: "minutes", shouldFail: false },
  { value: 1_000_001, unit: "minutes", shouldFail: true },
  { value: -1, unit: "minutes", shouldFail: true },
];

for (const test of tests) {
  const rule = {
    Name: `test-${test.value}`,
    ScheduleExpression: `rate(${test.value} ${test.unit})`,
    EventBusName: "default",
    State: "ENABLED",
  };
  
  const client = new MockEventBridgeClient([rule]);
  const scanner = new EventBridgeScanner(client);
  
  scanner.scan({}).then(tasks => {
    if (test.shouldFail) {
      if (tasks.length === 1 && !tasks[0].nextRun && !tasks[0].interval) {
        console.log(`PASS: ${test.value} ${test.unit} (should fail) -> rule included but without nextRun/interval`);
      } else {
        console.log(`FAIL: ${test.value} ${test.unit} (should fail) -> unexpected result:`, tasks[0]);
      }
    } else {
      if (tasks.length === 1 && tasks[0].nextRun && tasks[0].interval) {
        console.log(`PASS: ${test.value} ${test.unit} (should pass) -> rule with nextRun and interval`);
      } else {
        console.log(`FAIL: ${test.value} ${test.unit} (should pass) -> unexpected result:`, tasks[0]);
      }
    }
  });
}
