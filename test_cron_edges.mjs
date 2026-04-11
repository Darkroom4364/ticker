import { parseCronExpression } from './dist/utils/cron.js';

const tests = [
  // Negative numbers (should fail)
  ["-1 * * * *", "negative in minute field"],
  ["* -1 * * *", "negative in hour field"],
  
  // Range edge cases (should fail)
  ["5- * * * *", "incomplete range (end missing)"],
  ["-5 * * * *", "incomplete range (start missing)"],
  ["1--2 * * * *", "double dash"],
  ["1-2-3 * * * *", "triple range"],
  
  // Non-numeric values (should fail)
  ["abc * * * *", "letters"],
  ["1.5 * * * *", "decimal"],
  ["1e5 * * * *", "scientific notation"],
  
  // Valid cases
  ["0-59 * * * *", "valid range 0-59"],
  ["*/15 * * * *", "valid step"],
];

for (const [expr, desc] of tests) {
  try {
    parseCronExpression(expr);
    console.log(`PASS: ${desc} -> accepted (${expr})`);
  } catch (e) {
    console.log(`PASS: ${desc} -> rejected (${expr})`);
  }
}
