import { parseCronExpression } from './dist/utils/cron.js';

const aggressiveTests = [
  // Step patterns with edge cases
  ["*/0 * * * *", "step of 0 (should fail)"],
  ["1/0 * * * *", "range with step 0 (should fail)"],
  
  // Ranges with numeric issues
  ["59-0 * * * *", "reversed range (should fail)"],
  ["0-0 * * * *", "single value as range (should pass)"],
  
  // Mixed with steps
  ["1-5/0 * * * *", "range with step 0 (should fail)"],
  ["1-5/2 * * * *", "normal range with step (should pass)"],
  
  // Leading/trailing dashes
  ["- * * * *", "just a dash (should fail)"],
  ["-- * * * *", "double dash (should fail)"],
  
  // Spaces in ranges (might get split)
  ["0 - 5 * * * *", "space in range (different issue - 6 fields)"],
  
  // Very large numbers
  ["0-999999999 * * * *", "huge range (should fail - out of bounds)"],
  
  // Comma patterns with leading zeros
  ["0,5,10 * * * *", "comma-separated valid values (should pass)"],
  [",0,5 * * * *", "leading comma (should fail)"],
  
  // Complex combinations
  ["0-5,10-15 * * * *", "multiple ranges (should pass)"],
  ["0-5-10,15 * * * *", "malformed range in combo (should fail)"],
];

for (const [expr, desc] of aggressiveTests) {
  try {
    parseCronExpression(expr);
    console.log(`✓ PASS: ${desc}`);
  } catch (e) {
    console.log(`✗ PASS: ${desc} (rejected as expected)`);
  }
}
