import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileNoFollow } from "./safe-write";

/** Lines every hush project wants ignored; the export default is included too. */
export const GITIGNORE_ENTRIES = [".env", ".env.*", "!.env.example", "hush-key.json"];

export interface GitignoreResult {
  path: string;
  added: string[];
  alreadyCovered: string[];
}

export function ensureGitignoreEntries(
  cwd: string,
  entries: string[] = GITIGNORE_ENTRIES,
): GitignoreResult {
  const path = join(cwd, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing.split(/\r?\n/).map((line) => line.trim());
  const added: string[] = [];
  const alreadyCovered: string[] = [];

  for (const entry of entries) {
    if (lines.includes(entry)) {
      alreadyCovered.push(entry);
    } else {
      added.push(entry);
    }
  }

  if (added.length > 0) {
    const block = `${existing && !existing.endsWith("\n") ? "\n" : ""}${existing ? "\n" : ""}# hush.hanx.pro, never commit real secrets\n${added.join("\n")}\n`;
    writeFileNoFollow(path, existing + block, 0o644);
  }

  return { path, added, alreadyCovered };
}

export interface GitignoreStatus {
  covered: boolean;
  missing: string[];
}

export function checkGitignore(cwd: string): GitignoreStatus {
  const path = join(cwd, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing.split(/\r?\n/).map((line) => line.trim());
  const missing = GITIGNORE_ENTRIES.filter((entry) => !lines.includes(entry));
  return { covered: missing.length === 0, missing };
}
