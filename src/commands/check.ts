import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineCommand } from "citty";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import {
  canonicalizeEnvContent,
  compareWithExample,
  parseEnvContent,
} from "../lib/dotenv-file";
import { assertEnvFileInsideCwd } from "../lib/env-path";
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
import { green, info, isJsonMode, printJson, red, warn, yellow } from "../lib/ui";

/**
 * `hush check`, the CI/pre-commit guard.
 *
 * Compares your local .env against .env.example (missing = failure) and,
 * with --remote, against the deployed environment. Exit code 1 when anything
 * required is missing, so it can gate a build.
 */
export const checkCommand = defineCommand({
  meta: { name: "check", description: "Check for missing/extra variables (CI friendly)" },
  args: {
    ...globalArgs,
    file: { type: "positional", description: "Local env file", required: false, default: ".env" },
    example: {
      type: "string",
      description: "Example file to compare against",
      default: ".env.example",
    },
    env: { type: "string", alias: "e", description: "Environment name (with --remote)" },
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
    remote: {
      type: "boolean",
      description: "Also compare against the remote environment",
      default: false,
    },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const filePath = resolve(process.cwd(), String(args.file ?? ".env"));
      if (!existsSync(filePath)) {
        throw new CliError(`${args.file ?? ".env"} not found.`, 2, "Run `hush pull` to get it.");
      }
      assertEnvFileInsideCwd(filePath);
      const local = parseEnvContent(canonicalizeEnvContent(readFileSync(filePath, "utf8")));

      const missing: string[] = [];
      const extra: string[] = [];
      const compared: string[] = [];

      const examplePath = resolve(process.cwd(), String(args.example ?? ".env.example"));
      if (existsSync(examplePath)) {
        compared.push(String(args.example ?? ".env.example"));
        assertEnvFileInsideCwd(examplePath);
        const example = parseEnvContent(canonicalizeEnvContent(readFileSync(examplePath, "utf8")));
        const result = compareWithExample(example, local);
        missing.push(...result.missing);
        extra.push(...result.extra);
      } else {
        warn(`${args.example} not found, skipping the example comparison.`);
      }

      if (args.remote) {
        const client = await requireClient(args);
        const slug = resolveSlug(args.project as string | undefined);
        const detail = await loadProjectDetail(client, slug);
        const identity = await loadIdentity(client);
        findMe(detail, identity.userId);
        const environment = pickEnvironment(detail, args.env as string | undefined);
        const latest = await fetchLatestOrNull(client, slug, environment.name);
        if (!latest) {
          warn(`No versions in "${environment.name}" yet, skipping the remote comparison.`);
        } else {
          compared.push(`${slug}/${environment.name} v${latest.version.version}`);
          const { privateKey, publicKey } = await requirePrivateKey(client, { prompt: true });
          const { projectKey } = await openProjectKey(detail, privateKey, publicKey);
          const remote = parseEnvContent(
            await decryptVersion(detail.project.id, latest, projectKey, {
              environmentName: environment.name,
            }),
          );
          for (const key of remote.vars.keys()) {
            if (!local.vars.has(key)) {
              missing.push(key);
            }
          }
          for (const key of local.vars.keys()) {
            if (!remote.vars.has(key)) {
              extra.push(key);
            }
          }
        }
      }

      const uniqueMissing = [...new Set(missing)];
      const uniqueExtra = [...new Set(extra)];

      if (isJsonMode()) {
        printJson({
          ok: uniqueMissing.length === 0,
          missing: uniqueMissing,
          extra: uniqueExtra,
          comparedWith: compared,
        });
      } else if (uniqueMissing.length === 0 && uniqueExtra.length === 0) {
        console.log(`${green("✔")} All good. ${local.vars.size} variables, nothing missing.`);
        info(`Compared with: ${compared.join(", ") || "nothing (no example file found)"}`);
      } else {
        if (uniqueMissing.length > 0) {
          console.log(
            red(`${uniqueMissing.length} variable${uniqueMissing.length === 1 ? "" : "s"} missing from ${args.file ?? ".env"}:`),
          );
          for (const key of uniqueMissing) {
            console.log(red(`  - ${key}`));
          }
        }
        if (uniqueExtra.length > 0) {
          console.log(
            yellow(`${uniqueExtra.length} variable${uniqueExtra.length === 1 ? "" : "s"} here but not in the reference:`),
          );
          for (const key of uniqueExtra) {
            console.log(yellow(`  + ${key}`));
          }
        }
        info(`Compared with: ${compared.join(", ") || "nothing"}`);
      }

      if (uniqueMissing.length > 0) {
        process.exitCode = 1;
      }
    });
  },
});
