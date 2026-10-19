import { wrapProjectKeyForMember } from "@hush/crypto";
import {
  api,
  PRODUCT,
  type InviteResponse,
  type UserLookupResponse,
} from "@hush/schemas";
import { defineCommand } from "citty";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import { CliError } from "../lib/errors";
import { findMe, loadProjectDetail, openProjectKey, requireRole, resolveSlug } from "../lib/project-ops";
import { loadIdentity, requirePrivateKey } from "../lib/session";
import { bold, info, isJsonMode, printJson, success } from "../lib/ui";

/**
 * `hush invite @teammate`, wrap the project key for their public key and send
 * the invite. Only the sealed blob is uploaded; the server still cannot open it.
 */
export const inviteCommand = defineCommand({
  meta: { name: "invite", description: "Invite a GitHub user to this project" },
  args: {
    ...globalArgs,
    username: { type: "positional", description: "GitHub username", required: true },
    role: {
      type: "string",
      description: "Role: admin, member or readonly (default: member)",
      default: "member",
    },
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const username = String(args.username).replace(/^@/, "").trim();
      const role = String(args.role ?? "member").toLowerCase();
      if (!["admin", "member", "readonly"].includes(role)) {
        throw CliError.usage(`Unknown role "${role}".`, "Use admin, member or readonly.");
      }

      const client = await requireClient(args);
      const slug = resolveSlug(args.project as string | undefined);
      const detail = await loadProjectDetail(client, slug);
      const identity = await loadIdentity(client);
      const me = findMe(detail, identity.userId);
      requireRole(me, "admin");

      const { user: target } = await client.get<UserLookupResponse>(
        api.users.byGithub(username),
      );

      const { privateKey, publicKey } = await requirePrivateKey(client, { prompt: true });
      const { projectKey, keyVersion } = await openProjectKey(detail, privateKey, publicKey);
      if (detail.myKey && detail.myKey.keyVersion !== keyVersion) {
        throw CliError.conflict("Your key version just changed.", "Run the command again.");
      }
      const wrappedProjectKey = await wrapProjectKeyForMember(projectKey, target.publicKey);

      const { invite, token } = await client.post<InviteResponse>(
        api.projects.members(slug),
        { githubUsername: target.githubUsername, role, wrappedProjectKey },
      );

      if (isJsonMode()) {
        printJson({ invite, token });
        return;
      }
      success(`Invited ${bold(`@${target.githubUsername}`)} as ${role}.`);
      info(
        `They sign in at ${PRODUCT.url} and accept from the dashboard (or use the token below).`,
      );
      info(`Invite token (valid until ${new Date(invite.expiresAt).toLocaleDateString()}): ${token}`);
    });
  },
});
