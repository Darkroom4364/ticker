#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("ticker")
  .description("Discover every scheduled job across your infrastructure")
  .version("0.1.0");

program
  .command("scan")
  .description("Scan infrastructure for scheduled jobs")
  .option("-f, --format <format>", "output format (table, json, yaml)", "table")
  .option("-s, --scanners <scanners...>", "specific scanners to run")
  .action((options: { format: string; scanners?: string[] }) => {
    console.log("Scanning for scheduled jobs...");
    console.log(`Format: ${options.format}`);
    if (options.scanners) {
      console.log(`Scanners: ${options.scanners.join(", ")}`);
    }
    console.log("\nNo scanners implemented yet. Coming soon!");
  });

program.parse();
