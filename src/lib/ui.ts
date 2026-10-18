import { spinner as clackSpinner } from "@clack/prompts";
import pc from "picocolors";
import { MASK } from "./dotenv-file";

/**
 * Terminal output. Colors degrade gracefully: --no-color, NO_COLOR, or a
 * non-TTY stdout all disable them. Everything the user sees goes through here
 * so `--json` output stays clean and machine-readable.
 */

let colorEnabled = true;
let jsonMode = false;

export function configureUi(options: { color?: boolean; json?: boolean }): void {
  if (options.color !== undefined) {
    colorEnabled = options.color;
  }
  if (options.json !== undefined) {
    jsonMode = options.json;
  }
  if (process.env.NO_COLOR) {
    colorEnabled = false;
  }
}

export function isJsonMode(): boolean {
  return jsonMode;
}

const colors = (): ReturnType<typeof pc.createColors> => pc.createColors(colorEnabled);

export const symbol = {
  ok: "✔",
  fail: "✖",
  warn: "!",
  arrow: "→",
  bullet: "•",
  lock: "🔒",
};

export function out(line = ""): void {
  console.log(line);
}

export function success(message: string): void {
  console.log(`${colors().green(symbol.ok)} ${message}`);
}

export function warn(message: string): void {
  console.log(`${colors().yellow(symbol.warn)} ${message}`);
}

export function fail(message: string, hint?: string): void {
  console.error(`${colors().red(symbol.fail)} ${message}`);
  if (hint) {
    console.error(`  ${colors().dim(hint)}`);
  }
}

export function info(message: string): void {
  console.log(colors().dim(message));
}

export function bold(message: string): string {
  return colors().bold(message);
}

export function dim(message: string): string {
  return colors().dim(message);
}

export function green(message: string): string {
  return colors().green(message);
}

export function red(message: string): string {
  return colors().red(message);
}

export function yellow(message: string): string {
  return colors().yellow(message);
}

export function cyan(message: string): string {
  return colors().cyan(message);
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** `FOO=••••••••` or `FOO=value` with --reveal. */
export function varLine(key: string, value: string, reveal: boolean): string {
  return `${key}=${reveal ? value : MASK}`;
}

export interface EnvDiffView {
  reveal: boolean;
  added: Array<{ key: string; value: string }>;
  removed: Array<{ key: string; value: string }>;
  changed: Array<{ key: string; from: string; to: string }>;
}

/** The `+ ~ -` diff view used by diff/pull/push. Values masked unless --reveal. */
export function printEnvDiff(view: EnvDiffView): void {
  for (const item of view.added) {
    console.log(diffLine("add", varLine(item.key, item.value, view.reveal)));
  }
  for (const item of view.changed) {
    console.log(
      diffLine(
        "change",
        `${item.key}: ${varLine("", item.from, view.reveal).slice(1)} ${symbol.arrow} ${varLine("", item.to, view.reveal).slice(1)}`,
      ),
    );
  }
  for (const item of view.removed) {
    console.log(diffLine("remove", varLine(item.key, item.value, view.reveal)));
  }
}

export function diffLine(kind: "add" | "remove" | "change", text: string): string {
  if (kind === "add") {
    return colors().green(`+ ${text}`);
  }
  if (kind === "remove") {
    return colors().red(`- ${text}`);
  }
  return colors().yellow(`~ ${text}`);
}

/** Matches ANSI SGR escapes so column widths can be computed from visible text. */
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function visibleLength(text: string): number {
  return text.replace(ANSI_PATTERN, "").length;
}

export function table(rows: Array<Array<string>>, options: { gap?: number } = {}): string {
  if (rows.length === 0) {
    return "";
  }
  const gap = " ".repeat(options.gap ?? 2);
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, visibleLength(cell));
    });
  }
  return rows
    .map((row) =>
      row
        .map((cell, i) => {
          const pad = " ".repeat(Math.max(0, (widths[i] ?? 0) - visibleLength(cell)));
          return i === row.length - 1 ? cell : cell + pad;
        })
        .join(gap)
        .trimEnd(),
    )
    .join("\n");
}

export async function withSpinner<T>(label: string, task: () => Promise<T>): Promise<T> {
  const spin = createSpinner(label);
  try {
    const result = await task();
    spin.stop(label);
    return result;
  } catch (error) {
    spin.fail(label);
    throw error;
  }
}

export interface Spinner {
  update: (message: string) => void;
  stop: (message?: string) => void;
  fail: (message?: string) => void;
}

/** No-op spinner when output is JSON or not a TTY (safe in CI and pipes). */
export function createSpinner(label: string): Spinner {
  if (jsonMode || !process.stdout.isTTY) {
    return { update: () => {}, stop: () => {}, fail: () => {} };
  }
  const spin = clackSpinner();
  spin.start(label);
  return {
    update: (message: string) => spin.message(message),
    stop: (message?: string) => spin.stop(message ?? label),
    fail: (message?: string) => spin.stop(`${message ?? label} — failed`),
  };
}

export function relativeTime(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return date.toISOString().slice(0, 10);
}

export function bytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
