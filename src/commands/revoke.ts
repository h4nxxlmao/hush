import { confirm, isCancel } from "@clack/prompts";
import {
  generateProjectKey,
  openEnvFile,
  sealEnvFile,
  wrapProjectKeyForMember,
} from "@hush/crypto";
import {
  api,
  type RemoveMemberResponse,
  type RekeyEnvironmentEntry,
  type RekeyMemberEntry,
} from "@hush/schemas";
import { defineCommand } from "citty";
import { globalArgs, isInteractive, requireClient, runWithArgs } from "../lib/command";
import { CliError } from "../lib/errors";
import {
  fetchLatestOrNull,
  findMe,
  loadProjectDetail,
  openProjectKey,
  requireRole,
  resolveSlug,
} from "../lib/project-ops";
import { loadIdentity, requirePrivateKey } from "../lib/session";
import { bold, cyan, info, isJsonMode, printJson, success, warn } from "../lib/ui";

/**
 * `hush revoke @teammate`, remove a member and rotate the project key.
 *
 * The rotation happens here, on the client:
 *  1. generate a fresh project key (keyVersion + 1)
 *  2. decrypt the latest version of every environment with the current key
 *  3. re-encrypt it under the new key at version + 1
 *  4. re-wrap the new key for every remaining member
 *  5. send it all as one payload; the server applies it atomically
 *
 * Honest limit (printed after success): a member who already pulled data keeps
 * that data. Rotate the underlying secrets to really cut them off.
 */
export const revokeCommand = defineCommand({
  meta: { name: "revoke", description: "Revoke a member and rotate the project key" },
  args: {
    ...globalArgs,
    username: { type: "positional", description: "GitHub username to revoke", required: true },
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const username = String(args.username).replace(/^@/, "").trim().toLowerCase();
      const client = await requireClient(args);
      const slug = resolveSlug(args.project as string | undefined);
      const detail = await loadProjectDetail(client, slug);
      const identity = await loadIdentity(client);
      const me = findMe(detail, identity.userId);
      requireRole(me, "admin");

      const target = detail.members.find(
        (member) => member.githubUsername?.toLowerCase() === username,
      );
      if (!target) {
        throw CliError.usage(
          `@${username} is not a member of ${slug}.`,
          `Members: ${detail.members.map((m) => `@${m.githubUsername ?? m.userId}`).join(", ")}`,
        );
      }
      if (target.role === "owner") {
        throw CliError.usage("The owner can't be revoked.", "Delete the project instead, or transfer it first.");
      }
      if (target.userId === identity.userId) {
        throw CliError.usage("You can't revoke yourself.", "Ask another admin to do it.");
      }

      if (!args.yes && isInteractive()) {
        const ok = await confirm({
          message: `Revoke @${username} and rotate the project key? They lose access immediately (already-pulled data stays with them).`,
          initialValue: false,
        });
        if (isCancel(ok) || !ok) {
          info("Nothing changed.");
          return;
        }
      }

      const { privateKey, publicKey } = await requirePrivateKey(client, { prompt: true });
      const { projectKey, keyVersion } = await openProjectKey(detail, privateKey, publicKey);
      const newKeyVersion = keyVersion + 1;
      const newProjectKey = await generateProjectKey();

      const environments: RekeyEnvironmentEntry[] = [];
      for (const environment of detail.environments) {
        if (environment.latestVersion === 0) {
          continue;
        }
        const latest = await fetchLatestOrNull(client, slug, environment.name);
        if (!latest) {
          continue;
        }
        const plaintext = await openEnvFile(
          latest.version.ciphertext,
          latest.version.nonce,
          projectKey,
          {
            projectId: detail.project.id,
            environmentName: environment.name,
            version: latest.version.version,
            keyVersion: latest.version.keyVersion,
          },
        );
        const resealed = await sealEnvFile(plaintext, newProjectKey, {
          projectId: detail.project.id,
          environmentName: environment.name,
          version: latest.version.version + 1,
          keyVersion: newKeyVersion,
        });
        environments.push({
          environmentId: environment.id,
          baseVersion: latest.version.version,
          ciphertext: resealed.ciphertext,
          nonce: resealed.nonce,
          sizeBytes: resealed.sizeBytes,
          contentHash: resealed.contentHash,
        });
      }

      const remaining = detail.members.filter((member) => member.userId !== target.userId);
      const members: RekeyMemberEntry[] = [];
      for (const member of remaining) {
        if (!member.publicKey) {
          throw new CliError(
            `@${member.githubUsername ?? member.userId} has no public key on file.`,
            1,
            "They must sign in once (`hush login`) before the key can be rotated.",
          );
        }
        members.push({
          userId: member.userId,
          wrappedProjectKey: await wrapProjectKeyForMember(newProjectKey, member.publicKey),
        });
      }

      const result = await client.del<RemoveMemberResponse>(
        api.projects.member(slug, target.userId),
        {
          revokedUserId: target.userId,
          keyVersion: newKeyVersion,
          environments,
          members,
        },
      );

      if (isJsonMode()) {
        printJson({
          revoked: username,
          keyVersion: result.keyVersion,
          environmentsRotated: environments.length,
          membersRewrapped: members.length,
        });
        return;
      }
      success(
        `Revoked ${bold(`@${username}`)} and rotated the project key to ${cyan(`v${result.keyVersion}`)}.`,
      );
      info(
        `${environments.length} environment${environments.length === 1 ? "" : "s"} re-encrypted, ${members.length} member${members.length === 1 ? "" : "s"} re-wrapped. The server never saw a key.`,
      );
      warn(
        "They still have any data they pulled before now. Rotate the underlying secrets to really cut them off.",
      );
    });
  },
});
