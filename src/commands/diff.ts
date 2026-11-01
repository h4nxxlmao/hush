import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineCommand } from "citty";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import {
  canonicalizeEnvContent,
  diffEnvs,
  formatChangeSummary,
  parseEnvContent,
} from "../lib/dotenv-file";
import { assertEnvFileInsideCwd } from "../lib/env-path";
import { CliError } from "../lib/errors";
import {
  decryptVersion,
  fetchLatestOrNull,
  fetchVersion,
  findMe,
  loadProjectDetail,
  openProjectKey,
  pickEnvironment,
  resolveSlug,
} from "../lib/project-ops";
import { loadIdentity, requirePrivateKey } from "../lib/session";
import {
  info,
  isJsonMode,
  printEnvDiff,
  printJson,
  success,
  yellow,
} from "../lib/ui";

/**
 * `hush diff`, the local file against a remote version (latest by default).
 * Values are masked as •••••••• unless --reveal is passed.
 */
export const diffCommand = defineCommand({
  meta: { name: "diff", description: "Diff your local file against a remote version" },
  args: {
    ...globalArgs,
    file: { type: "positional", description: "Local env file", required: false, default: ".env" },
    env: { type: "string", alias: "e", description: "Environment name" },
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
    version: { type: "string", description: "Compare against a specific version number" },
    reveal: {
      type: "boolean",
      description: "Show real values instead of ••••••••",
      default: false,
    },
    exitCode: {
      type: "boolean",
      description: "Exit 1 when the local file and remote version differ",
      default: false,
    },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const client = await requireClient(args);
      const slug = resolveSlug(args.project as string | undefined);
      const filePath = resolve(process.cwd(), String(args.file ?? ".env"));
      if (!existsSync(filePath)) {
        throw CliError.usage(`${args.file ?? ".env"} not found in this folder.`);
      }
      assertEnvFileInsideCwd(filePath);
      const localParsed = parseEnvContent(canonicalizeEnvContent(readFileSync(filePath, "utf8")));

      const detail = await loadProjectDetail(client, slug);
      const identity = await loadIdentity(client);
      findMe(detail, identity.userId);
      const environment = pickEnvironment(detail, args.env as string | undefined);

      const requestedVersion = (args.version as string | undefined)?.trim();
      const versionNumber = requestedVersion ? Number(requestedVersion) : null;
      if (
        versionNumber !== null &&
        (!Number.isInteger(versionNumber) || versionNumber < 1)
      ) {
        throw CliError.usage(`--version expects a positive integer, got "${requestedVersion}".`);
      }
      const target =
        versionNumber !== null
          ? await fetchVersion(client, slug, environment.name, versionNumber)
          : await fetchLatestOrNull(client, slug, environment.name);
      if (!target) {
        throw new CliError(
          `No versions in "${environment.name}" yet.`,
          1,
          `Push one first: hush push -e ${environment.name}`,
        );
      }

      const { privateKey, publicKey } = await requirePrivateKey(client, { prompt: true });
      const { projectKey, keyVersion } = await openProjectKey(detail, privateKey, publicKey);
      if (target.version.keyVersion > keyVersion) {
        throw new CliError(
          `v${target.version.version} is sealed with key v${target.version.keyVersion}; you hold v${keyVersion}.`,
          3,
          "Ask an admin to re-wrap your key (re-invite), then try again.",
        );
      }

      const remoteContent = await decryptVersion(detail.project.id, target, projectKey, {
        environmentName: environment.name,
        version: target.version.version,
      });
      const remoteParsed = parseEnvContent(remoteContent);
      const diff = diffEnvs(localParsed, remoteParsed);
      const summary = formatChangeSummary(diff);

      if (isJsonMode()) {
        printJson({
          project: slug,
          environment: environment.name,
          version: target.version.version,
          added: diff.added,
          removed: diff.removed,
          changed: diff.changed.map((item) => ({ key: item.key })),
          unchanged: diff.unchanged,
          inSync: summary === "No changes.",
        });
        if (args.exitCode && summary !== "No changes.") {
          process.exitCode = 1;
        }
        return;
      }

      if (summary === "No changes.") {
        success(`No differences, your file matches v${target.version.version} exactly.`);
        return;
      }

      printEnvDiff({
        reveal: Boolean(args.reveal),
        added: diff.added.map((key) => ({ key, value: remoteParsed.vars.get(key) ?? "" })),
        removed: diff.removed.map((key) => ({ key, value: localParsed.vars.get(key) ?? "" })),
        changed: diff.changed,
      });
      console.log();
      console.log(
        yellow(
          `${summary} between your file and v${target.version.version}. (left: yours, right: remote)`,
        ),
      );
      info(args.reveal ? "Values shown (--reveal)." : "Values masked. Add --reveal to see them.");
      if (args.exitCode) {
        process.exitCode = 1;
      }
    });
  },
});
