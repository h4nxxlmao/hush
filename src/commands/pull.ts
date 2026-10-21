import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { defineCommand } from "citty";
import { globalArgs, requireClient, requireInteractive, runWithArgs } from "../lib/command";
import {
  canonicalizeEnvContent,
  diffEnvs,
  parseEnvContent,
  formatChangeSummary,
} from "../lib/dotenv-file";
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
import { writeFileNoFollow } from "../lib/safe-write";
import {
  bytes,
  info,
  isJsonMode,
  printEnvDiff,
  printJson,
  success,
  symbol,
  warn,
} from "../lib/ui";

/**
 * `hush pull`, fetch and decrypt the latest version.
 *
 * An existing local file is never clobbered silently: the diff is shown (values
 * masked) and the user confirms, unless --force/--yes. The AAD binds the file to
 * this exact project/environment/version, so a swapped blob fails to decrypt.
 */
export const pullCommand = defineCommand({
  meta: { name: "pull", description: "Download and decrypt the latest version" },
  args: {
    ...globalArgs,
    env: { type: "string", alias: "e", description: "Environment name (default: linked/env)" },
    out: { type: "string", alias: "o", description: "File to write (default: .env)" },
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
    force: {
      type: "boolean",
      description: "Overwrite a differing local file without asking",
      default: false,
    },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
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
      const { projectKey, keyVersion } = await openProjectKey(detail, privateKey, publicKey);
      if (latest.version.keyVersion > keyVersion) {
        throw new CliError(
          `This version is sealed with key v${latest.version.keyVersion}; you hold v${keyVersion}.`,
          3,
          "A revoke rotated the project key. Ask an admin to invite you again so your key is re-wrapped.",
        );
      }

      const remoteContent = await decryptVersion(detail.project.id, latest, projectKey, {
        environmentName: environment.name,
      });
      const remoteParsed = parseEnvContent(remoteContent);
      const outPath = resolve(process.cwd(), (args.out as string | undefined) ?? ".env");

      if (existsSync(outPath)) {
        const localContent = canonicalizeEnvContent(readFileSync(outPath, "utf8"));
        if (localContent === remoteContent) {
          if (isJsonMode()) {
            printJson({
              pulled: false,
              reason: "up_to_date",
              version: latest.version.version,
              file: outPath,
            });
          } else {
            success(`Already up to date (v${latest.version.version}).`);
          }
          return;
        }
        const localParsed = parseEnvContent(localContent);
        const diff = diffEnvs(localParsed, remoteParsed);
        if (!isJsonMode()) {
          printEnvDiff({
            reveal: false,
            added: diff.added.map((key) => ({ key, value: remoteParsed.vars.get(key) ?? "" })),
            removed: diff.removed.map((key) => ({ key, value: localParsed.vars.get(key) ?? "" })),
            changed: diff.changed,
          });
          info(`Remote change: ${formatChangeSummary(diff)}`);
        }
        if (args.force) {
          if (!isJsonMode()) {
            warn(`Overwriting ${basename(outPath)} (--force).`);
          }
        } else if (!args.yes) {
          requireInteractive("confirm an overwrite");
          const ok = await confirm({
            message: `Overwrite ${basename(outPath)} with v${latest.version.version}? Local edits shown above are lost.`,
            initialValue: false,
          });
          if (isCancel(ok) || !ok) {
            info("Nothing written. Local file kept.");
            return;
          }
        }
      }

      writeFileNoFollow(outPath, remoteContent, 0o600);
      if (isJsonMode()) {
        printJson({
          pulled: true,
          version: latest.version.version,
          environment: environment.name,
          file: outPath,
          variables: remoteParsed.vars.size,
          sizeBytes: latest.version.sizeBytes,
        });
        return;
      }
      success(
        `Pulled v${latest.version.version} ${symbol.arrow} ${basename(outPath)} (${remoteParsed.vars.size} variables, ${bytes(latest.version.sizeBytes)}).`,
      );
      info("Decrypted on this machine. The server only ever held the ciphertext.");
    });
  },
});
