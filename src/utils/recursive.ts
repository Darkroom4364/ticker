import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "vendor",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".venv",
  "coverage",
  ".claude",
];

export async function discoverDirectories(
  rootPath: string,
  ignorePatterns?: string[],
): Promise<string[]> {
  const ignore = new Set(ignorePatterns ?? DEFAULT_IGNORE);
  const abs = resolve(rootPath);

  const entries = await readdir(abs, { recursive: true, withFileTypes: true });

  const dirs = entries
    .filter((e) => {
      if (!e.isDirectory()) return false;
      const parent = e.parentPath ?? (e as unknown as { path: string }).path;
      const rel = join(parent, e.name);
      return !rel.split("/").some((seg) => ignore.has(seg));
    })
    .map((e) => {
      const parent = e.parentPath ?? (e as unknown as { path: string }).path;
      return resolve(parent, e.name);
    });

  return [...new Set([abs, ...dirs])];
}
