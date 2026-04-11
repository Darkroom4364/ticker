import * as schedex from './dist/index.js';

const tests = [
  // Should exist
  ["parseCronExpression", typeof schedex.parseCronExpression],
  ["describeCronExpression", typeof schedex.describeCronExpression],
  ["getNextCronRun", typeof schedex.getNextCronRun],
  ["PartialScanError", typeof schedex.PartialScanError],
  
  // These were REMOVED but might have been in use
  ["orchestrate", typeof schedex.orchestrate],
  ["format", typeof schedex.format],
  ["formatTable", typeof schedex.formatTable],
  ["formatJson", typeof schedex.formatJson],
  ["formatYaml", typeof schedex.formatYaml],
  ["CrontabScanner", typeof schedex.CrontabScanner],
  ["SystemdScanner", typeof schedex.SystemdScanner],
  ["EventBridgeScanner", typeof schedex.EventBridgeScanner],
];

for (const [name, type] of tests) {
  if (type === "undefined") {
    console.log(`ERROR: ${name} is no longer exported (was removed!)`);
  } else {
    console.log(`OK: ${name} is exported as ${type}`);
  }
}
