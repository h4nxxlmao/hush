import { spawn } from "node:child_process";
import { defineCommand } from "citty";
import { buildChildEnv } from "../lib/child-env";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import { parseEnvContent } from "../lib/dotenv-file";
import { CliError } from "../lib/errors";
import {
  decryptVersion,
  fetchLatestOrNull,
  findMe,
  loadProjectDetail,
  openProjectKey,
  pickEnvironment,
  resolveSlug,
} from "../lib/project-ops";
import { loadIdentity, requirePrivateKey } from "../lib/session";
import { cyan, info, isJsonMode, warn } from "../lib/ui";

/**
 * `hush run -e dev -- <command>`, inject variables into a process without
 * writing any file. The plaintext lives in this process's memory only, and the
 * child inherits stdio so interactive commands work.
 */

function extractCommand(positional: string | undefined, rawArgs: string[]): string[] {
  const separator = rawArgs.indexOf("--");
  if (separator !== -1 && separator < rawArgs.length - 1) {
    return rawArgs.slice(separator + 1);
  }
  return positional ? [positional] : [];
}

/** "A,B" -> Set("A", "B"), ignoring empty segments. */
function parseKeyList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  );
}

export const runCommand = defineCommand({
  meta: { name: "run", description: "Run a command with the environment injected (no file written)" },
  args: {
    ...globalArgs,
    env: { type: "string", alias: "e", description: "Environment name" },
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
    only: { type: "string", description: "Comma-separated keys to inject (default: all)" },
    except: { type: "string", description: "Comma-separated keys to omit" },
    noInherit: {
      type: "boolean",
      description: "Do not inherit the parent environment",
      default: false,
    },
    cmd: { type: "positional", description: "Command (use: -- <command> …)", required: false },
  },
  run: async ({ args, rawArgs }) => {
    await runWithArgs(args, async () => {
      const command = extractCommand(args.cmd as string | undefined, rawArgs);
      if (command.length === 0) {
        throw CliError.usage(
          "No command given.",
          "Usage: hush run -e dev -- node server.js",
        );
      }

      const client = await requireClient(args);
      const slug = resolveSlug(args.project as string | undefined);
      const detail = await loadProjectDetail(client, slug);
      const identity = await loadIdentity(client);
      findMe(detail, identity.userId);
      const environment = pickEnvironment(detail, args.env as string | undefined);

      const latest = await fetchLatestOrNull(client, slug, environment.name);
      if (!latest) {
        throw new CliError(
          `No versions in "${environment.name}" yet.`,
          1,
          `Push one first: hush push -e ${environment.name}`,
        );
      }

      const { privateKey, publicKey } = await requirePrivateKey(client, { prompt: true });
      const { projectKey } = await openProjectKey(detail, privateKey, publicKey);
      const content = await decryptVersion(detail.project.id, latest, projectKey, {
        environmentName: environment.name,
      });
      const parsed = parseEnvContent(content);

      const only = parseKeyList(args.only as string | undefined);
      const except = parseKeyList(args.except as string | undefined);
      if (only.size > 0 && except.size > 0) {
        throw CliError.usage("Use --only or --except, not both.");
      }
      const { env: childEnv, blocked, injected } = buildChildEnv({
        parent: process.env,
        remote: parsed.vars,
        only,
        except,
        noInherit: Boolean(args.noInherit),
      });
      if (blocked.length > 0) {
        warn(
          `Ignored execution-affecting variables from the remote env: ${blocked.join(", ")}.`,
        );
      }

      if (!isJsonMode()) {
        info(
          `Running with ${injected} variables from ${cyan(`${slug}/${environment.name}`)} (v${latest.version.version}), nothing written to disk.`,
        );
      }

      const [program, ...rest] = command;
      const child = spawn(program!, rest, { stdio: "inherit", env: childEnv, shell: false });

      const forward = (signal: NodeJS.Signals) => () => {
        child.kill(signal);
      };
      process.on("SIGINT", forward("SIGINT"));
      process.on("SIGTERM", forward("SIGTERM"));

      const code: number | null = await new Promise((resolve) => {
        child.on("exit", (exitCode, signal) => {
          if (exitCode !== null) {
            resolve(exitCode);
          } else {
            resolve(signal ? 128 : 1);
          }
        });
        child.on("error", (error) => {
          resolve(127);
          process.stderr.write(`hush: could not run "${program}": ${error.message}\n`);
        });
      });

      process.exitCode = code ?? 1;
    });
  },
});
