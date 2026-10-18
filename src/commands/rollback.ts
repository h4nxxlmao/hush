import { openEnvFile, sealEnvFile } from "@hush/crypto";
import { api, type VersionResponse } from "@hush/schemas";
import { defineCommand } from "citty";
import { HushApiError } from "../lib/api";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import { CliError } from "../lib/errors";
import {
  fetchLatestOrNull,
  fetchVersion,
  findMe,
  loadProjectDetail,
  openProjectKey,
  pickEnvironment,
  requireRole,
  resolveSlug,
} from "../lib/project-ops";
import { loadIdentity, requirePrivateKey } from "../lib/session";
import { cyan, info, isJsonMode, printJson, success } from "../lib/ui";

/**
 * `hush rollback -e prod 7` — bring back the content of an old version.
 *
 * Because the version number is part of the AAD, this is a fresh encryption of
 * the old content, pushed as a new version. History keeps both; nothing is
 * rewritten and the server never sees a thing.
 */
export const rollbackCommand = defineCommand({
  meta: { name: "rollback", description: "Restore the content of an older version as a new version" },
  args: {
    ...globalArgs,
    version: { type: "positional", description: "Version number to restore", required: true },
    env: { type: "string", alias: "e", description: "Environment name" },
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
    message: { type: "string", alias: "m", description: "Note for the new version" },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const target = Number(args.version);
      if (!Number.isInteger(target) || target < 1) {
        throw CliError.usage(`--version expects a positive integer, got "${args.version}".`);
      }

      const client = await requireClient(args);
      const slug = resolveSlug(args.project as string | undefined);
      const detail = await loadProjectDetail(client, slug);
      const identity = await loadIdentity(client);
      const me = findMe(detail, identity.userId);
      requireRole(me, "member");
      const environment = pickEnvironment(detail, args.env as string | undefined);

      const { privateKey, publicKey } = await requirePrivateKey(client, { prompt: true });
      const { projectKey, keyVersion } = await openProjectKey(detail, privateKey, publicKey);

      const old = await fetchVersion(client, slug, environment.name, target);
      if (old.version.keyVersion > keyVersion) {
        throw new CliError(
          `v${target} was sealed with key v${old.version.keyVersion}; you hold v${keyVersion}.`,
          3,
          "After a revoke, older versions can't be reopened with the retired key. Pick a newer version.",
        );
      }
      const oldBytes = await openEnvFile(old.version.ciphertext, old.version.nonce, projectKey, {
        projectId: detail.project.id,
        environmentName: environment.name,
        version: target,
        keyVersion: old.version.keyVersion,
      });

      const latest = await fetchLatestOrNull(client, slug, environment.name);
      const nextVersion = latest ? latest.version.version + 1 : 1;
      const sealed = await sealEnvFile(oldBytes, projectKey, {
        projectId: detail.project.id,
        environmentName: environment.name,
        version: nextVersion,
        keyVersion,
      });

      try {
        const response = await client.post<VersionResponse>(
          api.projects.versions(slug, environment.name),
          {
            baseVersion: latest ? latest.version.version : 0,
            ciphertext: sealed.ciphertext,
            nonce: sealed.nonce,
            keyVersion,
            sizeBytes: sealed.sizeBytes,
            contentHash: sealed.contentHash,
            message: (args.message as string | undefined) ?? `Rollback to v${target}`,
            rollbackOf: target,
          },
        );
        if (isJsonMode()) {
          printJson({
            rolledBack: true,
            from: target,
            version: response.version.version,
            environment: environment.name,
          });
          return;
        }
        success(
          `Rolled back to v${target} as ${cyan(`v${response.version.version}`)} in ${environment.name}.`,
        );
        info("This is a new version — history keeps both, and the audit log shows the rollback.");
      } catch (error) {
        if (error instanceof HushApiError && error.code === "conflict") {
          const details = error.details as { local?: number; remote?: number } | undefined;
          throw CliError.conflict(
            `Someone pushed while you were looking (local v${details?.local ?? "?"}, remote v${details?.remote ?? "?"}).`,
            "Run `hush pull` first, then roll back again.",
          );
        }
        throw error;
      }
    });
  },
});
