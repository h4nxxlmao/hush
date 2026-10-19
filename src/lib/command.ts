import type { ArgsDef } from "citty";
import { createApiClient, HushApiError, exitCodeForError, type ApiClient } from "./api";
import { CliError } from "./errors";
import { loadToken } from "./session";
import { apiUrl } from "./state";
import { configureUi, fail, isJsonMode, printJson } from "./ui";

/**
 * Shared plumbing for every command: global flags, UI setup, error reporting
 * that maps to the documented exit codes (0 ok, 1 general, 2 usage, 3 auth,
 * 4 conflict), and a typed API client factory.
 */

export const globalArgs = {
  json: { type: "boolean", description: "Machine-readable JSON output", default: false },
  color: {
    type: "boolean",
    description: "Colorize output (use --no-color to disable)",
    default: true,
  },
  "api-url": { type: "string", description: "Override the API base URL" },
  yes: {
    type: "boolean",
    alias: "y",
    description: "Skip confirmation prompts",
    default: false,
  },
} satisfies ArgsDef;

export interface GlobalFlags {
  json?: boolean;
  color?: boolean;
  "api-url"?: string;
  yes?: boolean;
}

export function setup(args: GlobalFlags): void {
  configureUi({ color: args.color !== false, json: Boolean(args.json) });
}

function hintFor(error: HushApiError): string | undefined {
  switch (error.code) {
    case "network":
      return "Is the server reachable? Run `hush doctor`, or pass --api-url.";
    case "unauthorized":
      return "Run `hush login` to get a fresh token.";
    case "forbidden":
      return "Check your role in this project (`hush members`).";
    case "conflict":
      return "Run `hush pull` first, then try again.";
    case "rate_limited":
      return "Wait a moment and try again.";
    case "limit_exceeded":
      return "Free-tier limits apply, manage projects at https://hush.hanx.pro.";
    case "payload_too_large":
      return "env files are capped at 1 MB.";
    default:
      return undefined;
  }
}

export function reportError(error: unknown): void {
  if (error instanceof CliError) {
    if (isJsonMode()) {
      printJson({ error: { code: "cli", message: error.message, hint: error.hint } });
    } else {
      fail(error.message, error.hint);
    }
    process.exitCode = error.exitCode;
    return;
  }
  if (error instanceof HushApiError) {
    if (isJsonMode()) {
      printJson({
        error: { code: error.code, message: error.message, details: error.details },
      });
    } else {
      fail(error.message, hintFor(error));
    }
    process.exitCode = exitCodeForError(error);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (isJsonMode()) {
    printJson({ error: { code: "internal", message } });
  } else {
    fail(message);
  }
  process.exitCode = 1;
}

/** Every command body runs through this: UI config first, errors mapped to exit codes. */
export async function runWithArgs(
  args: GlobalFlags & Record<string, unknown>,
  body: () => Promise<void>,
): Promise<void> {
  setup(args);
  try {
    await body();
  } catch (error) {
    reportError(error);
  }
}

export async function requireClient(args: GlobalFlags): Promise<ApiClient> {
  const token = await loadToken();
  if (!token) {
    throw CliError.auth("Not signed in on this machine.", "Run `hush login` first.");
  }
  return createApiClient({ baseUrl: apiUrl(args["api-url"]), token });
}

export function unauthenticatedClient(args: GlobalFlags): ApiClient {
  return createApiClient({ baseUrl: apiUrl(args["api-url"]) });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !isJsonMode();
}

/** Prompts need a real terminal; fail with the right exit code instead of hanging. */
export function requireInteractive(what: string): void {
  if (!isInteractive()) {
    throw CliError.usage(
      `Cannot ${what} in non-interactive mode.`,
      "Run this command in an interactive terminal (or pass the relevant flags).",
    );
  }
}
