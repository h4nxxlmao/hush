import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeContentHash, sealEnvFile, utf8ToBytes } from "@hush/crypto";
import {
  api,
  LIMITS,
  type PushVersionRequest,
  type VersionResponse,
} from "@hush/schemas";
import { defineCommand } from "citty";
import { HushApiError } from "../lib/api";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import {
  canonicalizeEnvContent,
  diffEnvs,
  formatChangeSummary,
  parseEnvContent,
} from "../lib/dotenv-file";
import { assertEnvFileInsideCwd } from "../lib/env-path";
import { CliError } from "../lib/errors";
import { warnIfWorldReadable } from "../lib/file-perms";
import {
  decryptVersion,
  fetchLatestOrNull,
  findMe,
  loadProjectDetail,
  openProjectKey,
  pickEnvironment,
  requireRole,
  resolveSlug,
} from "../lib/project-ops";
import { loadIdentity, requirePrivateKey } from "../lib/session";
import { bytes, cyan, green, info, isJsonMode, printJson, success } from "../lib/ui";

/**
 * `hush push`, encrypt the file locally and upload the ciphertext.
 *
 * Conflict rule: the client sends the version it last saw (`baseVersion`). If
 * the server has moved on, the push fails with 409 and both numbers are shown.
 * --force re-reads the latest version and pushes again (re-sealing, because the
 * version number is part of the AAD).
 */
export const pushCommand = defineCommand({
  meta: { name: "push", description: "Encrypt a .env file and upload it as a new version" },
  args: {
    ...globalArgs,
    file: {
      type: "positional",
      description: "Env file to push",
      required: false,
      default: ".env",
    },
    env: { type: "string", alias: "e", description: "Environment name (default: linked/env)" },
    message: { type: "string", alias: "m", description: "Note for the version (never put secrets in it)" },
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
    force: {
      type: "boolean",
      description: "If someone else pushed first, pull their state and push anyway",
      default: false,
    },
    dryRun: {
      type: "boolean",
      description: "Show what would be pushed without uploading",
      default: false,
    },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const client = await requireClient(args);
      const slug = resolveSlug(args.project as string | undefined);
      const filePath = resolve(process.cwd(), String(args.file ?? ".env"));

      if (!existsSync(filePath)) {
        throw CliError.usage(
          `${args.file ?? ".env"} not found in this folder.`,
          "Pass a path: hush push .env.production -e prod",
        );
      }
      assertEnvFileInsideCwd(filePath);
      const content = canonicalizeEnvContent(readFileSync(filePath, "utf8"));
      if (Buffer.byteLength(content, "utf8") > LIMITS.MAX_PLAINTEXT_BYTES) {
        throw CliError.usage("That file is larger than the 1 MB limit.");
      }
      warnIfWorldReadable(filePath);

      const detail = await loadProjectDetail(client, slug);
      const identity = await loadIdentity(client);
      const me = findMe(detail, identity.userId);
      requireRole(me, "member");
      const environment = pickEnvironment(detail, args.env as string | undefined);

      const { privateKey, publicKey } = await requirePrivateKey(client, {
        prompt: true,
        cache: !args.dryRun,
      });
      const { projectKey, keyVersion } = await openProjectKey(detail, privateKey, publicKey);

      const localParsed = parseEnvContent(content);
      const localHash = await computeContentHash(utf8ToBytes(content), projectKey);

      let base = await fetchLatestOrNull(client, slug, environment.name);

      if (args.dryRun) {
        let summary = "No changes.";
        if (base) {
          try {
            const remoteContent = await decryptVersion(detail.project.id, base, projectKey, {
              environmentName: environment.name,
              version: base.version.version,
            });
            summary = formatChangeSummary(diffEnvs(parseEnvContent(remoteContent), localParsed));
          } catch {
            summary = "";
          }
        }
        const nextVersion = base ? base.version.version + 1 : 1;
        if (isJsonMode()) {
          printJson({
            pushed: false,
            reason: "dry_run",
            project: slug,
            environment: environment.name,
            baseVersion: base?.version.version ?? 0,
            nextVersion,
            summary,
            variables: localParsed.vars.size,
          });
          return;
        }
        success(
          `Dry run: would push v${nextVersion} to ${cyan(`${slug}/${environment.name}`)}${summary && summary !== "No changes." ? ` (${summary})` : ""}.`,
        );
        info(
          `${localParsed.vars.size} variables · nothing was encrypted or uploaded, and the key was not cached.`,
        );
        return;
      }

      if (base && base.version.contentHash === localHash && !args.force) {
        if (isJsonMode()) {
          printJson({
            pushed: false,
            reason: "no_changes",
            environment: environment.name,
            version: base.version.version,
          });
        } else {
          success(`No changes. ${environment.name} is already at v${base.version.version}.`);
        }
        return;
      }

      let summary = "";
      if (base) {
        try {
          const remoteContent = await decryptVersion(detail.project.id, base, projectKey, {
            environmentName: environment.name,
            version: base.version.version,
          });
          summary = formatChangeSummary(diffEnvs(parseEnvContent(remoteContent), localParsed));
        } catch {
          summary = "";
        }
      }

      let attempts = 0;
      for (;;) {
        attempts += 1;
        const nextVersion = base ? base.version.version + 1 : 1;
        const sealed = await sealEnvFile(utf8ToBytes(content), projectKey, {
          projectId: detail.project.id,
          environmentName: environment.name,
          version: nextVersion,
          keyVersion,
        });
        const body: PushVersionRequest = {
          baseVersion: base ? base.version.version : 0,
          ciphertext: sealed.ciphertext,
          nonce: sealed.nonce,
          keyVersion,
          sizeBytes: sealed.sizeBytes,
          contentHash: sealed.contentHash,
          message: (args.message as string | undefined) ?? null,
        };
        try {
          const response = await client.post<VersionResponse>(
            api.projects.versions(slug, environment.name),
            body,
          );
          if (isJsonMode()) {
            printJson({
              pushed: true,
              project: slug,
              environment: environment.name,
              version: response.version.version,
              summary,
              sizeBytes: response.version.sizeBytes,
            });
            return;
          }
          console.log(
            `${green("✔")} Pushed v${response.version.version} to ${cyan(`${slug}/${environment.name}`)}${summary && summary !== "No changes." ? `  ${cyan(summary)}` : ""}`,
          );
          info(`${localParsed.vars.size} variables · ${bytes(response.version.sizeBytes)} · sealed with the project key`);
          return;
        } catch (error) {
          if (error instanceof HushApiError && error.code === "conflict") {
            const details = error.details as { local?: number; remote?: number } | undefined;
            if (args.force && attempts < 3 && details) {
              base = await fetchLatestOrNull(client, slug, environment.name);
              continue;
            }
            if (details?.remote !== undefined && details?.local !== undefined) {
              throw CliError.conflict(
                `Your copy is behind: local v${details.local}, remote v${details.remote}.`,
                "Run `hush pull` first, then push again, or `hush push --force` to overwrite.",
              );
            }
          }
          throw error;
        }
      }
    });
  },
});
