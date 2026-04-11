// Test the systemd column detection

const testCases = [
  {
    name: "Normal header with all columns",
    header: "NEXT                         LEFT          LAST                         PASSED       UNIT                         ACTIVATES",
    expectZero: false
  },
  {
    name: "Missing NEXT column",
    header: "LEFT          LAST                         PASSED       UNIT                         ACTIVATES",
    expectZero: true
  },
  {
    name: "Missing LEFT column",
    header: "NEXT                         LAST                         PASSED       UNIT                         ACTIVATES",
    expectZero: false  // LEFT validation was NOT added to the fix
  },
  {
    name: "Missing UNIT column",
    header: "NEXT                         LEFT          LAST                         PASSED       ACTIVATES",
    expectZero: true
  },
  {
    name: "Missing ACTIVATES column (optional)",
    header: "NEXT                         LEFT          LAST                         PASSED       UNIT",
    expectZero: false  // ACTIVATES is optional (>= 0 check)
  },
];

for (const test of testCases) {
  const nextCol = test.header.indexOf("NEXT");
  const leftCol = test.header.indexOf("LEFT");
  const unitCol = test.header.indexOf("UNIT");
  const activatesCol = test.header.indexOf("ACTIVATES");
  
  // This is the check from the fixed code
  const willReturn = nextCol === -1 || leftCol === -1 || unitCol === -1;
  
  console.log(`${test.name}:`);
  console.log(`  nextCol=${nextCol}, leftCol=${leftCol}, unitCol=${unitCol}, activatesCol=${activatesCol}`);
  console.log(`  Check: (${nextCol} === -1 || ${leftCol} === -1 || ${unitCol} === -1) = ${willReturn}`);
  console.log(`  Expected to return empty: ${test.expectZero}, Actually will return empty: ${willReturn}`);
  console.log(`  ${willReturn === test.expectZero ? 'PASS' : 'FAIL'}`);
  console.log();
}
