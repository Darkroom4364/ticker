#!/usr/bin/env node

import { Command } from "commander";
import { orchestrate } from "./orchestrator.js";
import { format } from "./formatters/index.js";

const program = new Command();

program
  .name("ticker")
  .description("Discover every scheduled job across your infrastructure")
  .version("0.1.0");

program
  .command("scan")
  .description("Scan infrastructure for scheduled jobs")
  .option("-f, --format <format>", "output format (table, json, yaml)", "table")
  .option(
    "-s, --scanners <scanners>",
    "specific scanners to run (comma-separated, e.g. crontab,kubernetes)"
  )
  .option("-v, --verbose", "show scanner timing and error details")
  .action(
    async (options: {
      format: string;
      scanners?: string;
      verbose?: boolean;
    }) => {
      const formatName = options.format as "table" | "json" | "yaml";
      if (!["table", "json", "yaml"].includes(formatName)) {
        process.stderr.write(
          `Error: Invalid format '${options.format}'. Use table, json, or yaml.\n`
        );
        process.exit(1);
      }

      const scannerNames = options.scanners
        ? options.scanners.split(",").map((s) => s.trim())
        : undefined;

      const { tasks, results } = await orchestrate({
        scanners: scannerNames,
        format: formatName,
        verbose: options.verbose,
      });

      // Check if all scanners failed
      const allFailed =
        results.length > 0 && results.every((r) => r.error);

      const output = format(tasks, formatName);
      console.log(output);

      if (allFailed) {
        process.exit(1);
      }
    }
  );

program.parse();
