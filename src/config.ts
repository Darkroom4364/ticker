import { readFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

export interface SchedexConfig {
  /** Default output format */
  format?: "table" | "json" | "yaml";
  /** Which scanners to run (empty = all) */
  scanners?: string[];
  /** Show verbose output */
  verbose?: boolean;
  /** Recursively scan subdirectories for file-based scanners */
  recursive?: string;
}

const CONFIG_FILENAME = ".schedexrc.yml";
const CONFIG_HOME_PATH = join(".config", "schedex", "config.yml");

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function parseConfigFile(path: string): Promise<SchedexConfig> {
  const content = await readFile(path, "utf-8");
  const parsed = parseYaml(content);

  if (parsed === null || parsed === undefined) {
    return {};
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid config file: ${path} — expected a YAML mapping`);
  }

  const config: SchedexConfig = {};

  if (parsed.format !== undefined) {
    if (!["table", "json", "yaml"].includes(parsed.format)) {
      throw new Error(
        `Invalid format '${parsed.format}' in config file: ${path}. Use table, json, or yaml.`,
      );
    }
    config.format = parsed.format;
  }

  if (parsed.scanners !== undefined) {
    if (!Array.isArray(parsed.scanners)) {
      throw new Error(
        `Invalid scanners value in config file: ${path} — expected a list`,
      );
    }
    config.scanners = parsed.scanners.map(String);
  }

  if (parsed.verbose !== undefined) {
    config.verbose = Boolean(parsed.verbose);
  }

  if (parsed.recursive !== undefined) {
    config.recursive = String(parsed.recursive);
  }

  return config;
}

/**
 * Load config from the lookup order:
 * 1. Explicit --config path
 * 2. .schedexrc.yml in current working directory
 * 3. ~/.config/schedex/config.yml
 *
 * Returns null if no config file is found.
 * Throws if an explicit --config path doesn't exist.
 */
export async function loadConfig(
  configPath?: string,
): Promise<SchedexConfig | null> {
  // 1. Explicit path
  if (configPath) {
    const resolved = resolve(configPath);
    if (!(await fileExists(resolved))) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    return parseConfigFile(resolved);
  }

  // 2. CWD
  const cwdConfig = resolve(process.cwd(), CONFIG_FILENAME);
  if (await fileExists(cwdConfig)) {
    return parseConfigFile(cwdConfig);
  }

  // 3. Home directory
  const homeConfig = resolve(homedir(), CONFIG_HOME_PATH);
  if (await fileExists(homeConfig)) {
    return parseConfigFile(homeConfig);
  }

  return null;
}
