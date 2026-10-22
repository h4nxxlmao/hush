import { parse as parseDotenv } from "dotenv";

/**
 * .env parsing that keeps two separate concerns apart:
 *  - `vars`  : exact dotenv semantics for values (quotes, escapes, multiline,
 *              `export` prefix, empty values, comments)
 *  - `entries`: file order, so diffs and summaries read like the file does
 *
 * The file itself is what gets encrypted on push (normalized line endings), so
 * comments, blank lines and ordering survive a push/pull round trip untouched.
 */

export interface EnvEntry {
  key: string;
  value: string;
  line: number;
}

export interface ParsedEnvFile {
  entries: EnvEntry[];
  vars: Map<string, string>;
}

export function parseEnvContent(content: string): ParsedEnvFile {
  const vars = new Map(Object.entries(parseDotenv(content)));
  const entries: EnvEntry[] = [];
  const seen = new Set<string>();
  content.split(/\r?\n/).forEach((line, index) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match) {
      return;
    }
    const key = match[1]!;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push({ key, value: vars.get(key) ?? "", line: index + 1 });
  });
  return { entries, vars };
}

/** Canonical form for encryption: LF endings, exactly one trailing newline. */
export function canonicalizeEnvContent(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
  return normalized;
}

/** Blank every value while keeping the key order, for a safe .env.example. */
export function exampleFromEnvContent(content: string): string {
  const parsed = parseEnvContent(canonicalizeEnvContent(content));
  if (parsed.entries.length === 0) {
    return "";
  }
  return `${parsed.entries.map((entry) => `${entry.key}=`).join("\n")}\n`;
}

export interface EnvDiff {
  /** Keys in `to` that are absent from `from`. */
  added: string[];
  /** Keys in `from` that are absent from `to`. */
  removed: string[];
  /** Keys present in both with different values. */
  changed: Array<{ key: string; from: string; to: string }>;
  unchanged: number;
}

/** Changes needed to go from `from` to `to`. */
export function diffEnvs(from: ParsedEnvFile, to: ParsedEnvFile): EnvDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: EnvDiff["changed"] = [];
  let unchanged = 0;

  for (const [key, value] of to.vars) {
    if (!from.vars.has(key)) {
      added.push(key);
    } else if (from.vars.get(key) !== value) {
      changed.push({ key, from: from.vars.get(key) ?? "", to: value });
    } else {
      unchanged += 1;
    }
  }
  for (const key of from.vars.keys()) {
    if (!to.vars.has(key)) {
      removed.push(key);
    }
  }
  return { added, removed, changed, unchanged };
}

/** +3 ~1 -2 style summary; returns "No changes." when nothing moved. */
export function formatChangeSummary(diff: EnvDiff): string {
  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
    return "No changes.";
  }
  const parts: string[] = [];
  if (diff.added.length > 0) {
    parts.push(`+${diff.added.length}`);
  }
  if (diff.changed.length > 0) {
    parts.push(`~${diff.changed.length}`);
  }
  if (diff.removed.length > 0) {
    parts.push(`-${diff.removed.length}`);
  }
  return parts.join(" ");
}

export const MASK = "••••••••";

export function maskValue(value: string, reveal: boolean): string {
  if (reveal) {
    return value;
  }
  return value.length === 0 ? MASK : MASK;
}

export interface ExampleCheck {
  missing: string[];
  extra: string[];
}

/** Keys required by the example file but absent locally, and vice versa. */
export function compareWithExample(example: ParsedEnvFile, actual: ParsedEnvFile): ExampleCheck {
  const missing: string[] = [];
  const extra: string[] = [];
  for (const key of example.vars.keys()) {
    if (!actual.vars.has(key)) {
      missing.push(key);
    }
  }
  for (const key of actual.vars.keys()) {
    if (!example.vars.has(key)) {
      extra.push(key);
    }
  }
  return { missing, extra };
}
