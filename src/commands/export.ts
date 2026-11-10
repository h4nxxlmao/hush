import { resolve } from "node:path";
import { defineCommand } from "citty";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import { CliError } from "../lib/errors";
import { formatEnvExport, parseExportFormat, type ExportFormat } from "../lib/export-format";
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
import { writeFileNoFollow } from "../lib/safe-write";
import { info, isJsonMode, printJson, success } from "../lib/ui";

/**
 * `hush export`, decrypt a version and render it for another tool:
 * dotenv (raw), JSON (object), or shell (`export KEY=value`).
 */
export const exportCommand = defineCommand({
  meta: { name: "export", description: "Decrypt a version as dotenv, JSON or shell" },
  args: {
    ...globalArgs,
    env: { type: "string", alias: "e", description: "Environment name" },
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
    version: { type: "string", description: "Version number (default: latest)" },
    format: {
      type: "string",
      alias: "f",
      description: "Output format: dotenv, json, shell",
      default: "dotenv",
    },
    out: { type: "string", alias: "o", description: "Write to a file instead of stdout" },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      let format: ExportFormat;
      try {
        format = parseExportFormat(String(args.format ?? "dotenv"));
      } catch (error) {
        throw CliError.usage(error instanceof Error ? error.message : "Invalid format.");
      }
      const client = await requireClient(args);
      const slug = resolveSlug(args.project as string | undefined);
      const detail = await loadProjectDetail(client, slug);
      const identity = await loadIdentity(client);
      findMe(detail, identity.userId);
      const environment = pickEnvironment(detail, args.env as string | undefined);

      const requestedVersion = (args.version as string | undefined)?.trim();
      const versionNumber = requestedVersion ? Number(requestedVersion) : null;
      if (versionNumber !== null && (!Number.isInteger(versionNumber) || versionNumber < 1)) {
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
          "Ask an admin to re-wrap your key, then try again.",
        );
      }
      const content = await decryptVersion(detail.project.id, target, projectKey, {
        environmentName: environment.name,
        version: target.version.version,
      });
      const rendered = formatEnvExport(content, format);

      if (!args.out) {
        process.stdout.write(rendered);
        return;
      }

      const outPath = resolve(process.cwd(), String(args.out));
      writeFileNoFollow(outPath, rendered, 0o600);
      if (isJsonMode()) {
        printJson({
          exported: true,
          file: outPath,
          format,
          project: slug,
          environment: environment.name,
          version: target.version.version,
        });
        return;
      }
      success(`Exported ${environment.name} v${target.version.version} as ${format} to ${outPath}.`);
      info("The file is plaintext and mode 0600. Do not commit it.");
    });
  },
});
