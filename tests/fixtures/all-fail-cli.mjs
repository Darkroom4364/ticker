/**
 * Exercises the CLI's allFailed → exit(1) path.
 * Imports from the built dist to avoid needing tsx.
 */
import { orchestrate } from "../../dist/orchestrator.js";
import { format } from "../../dist/formatters/index.js";

const failingScanner = {
  name: "always-fails",
  async isAvailable() { return true; },
  async scan() {
    throw new Error("forced failure");
  },
};

const { tasks, results } = await orchestrate({}, [failingScanner]);

const allFailed = results.length > 0 && results.every((r) => r.error);

const output = format(tasks, "json");
process.stdout.write(output);

if (allFailed) {
  process.exit(1);
}
