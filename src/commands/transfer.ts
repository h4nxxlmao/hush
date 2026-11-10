import { confirm, isCancel } from "@clack/prompts";
import { api, type OkResponse } from "@hush/schemas";
import { defineCommand } from "citty";
import {
  globalArgs,
  isInteractive,
  requireClient,
  runWithArgs,
} from "../lib/command";
import { CliError } from "../lib/errors";
import { findMe, loadProjectDetail, resolveSlug } from "../lib/project-ops";
import { loadIdentity } from "../lib/session";
import { bold, isJsonMode, printJson, success } from "../lib/ui";

/** `hush transfer @user`, hand project ownership to another member. */
export const transferCommand = defineCommand({
  meta: { name: "transfer", description: "Transfer project ownership to another member" },
  args: {
    ...globalArgs,
    username: { type: "positional", description: "GitHub username", required: true },
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
      if (me.role !== "owner") {
        throw CliError.auth(
          "Only the project owner can transfer ownership.",
          "Ask the current owner to run this command.",
        );
      }
      const target = detail.members.find(
        (member) => member.githubUsername?.toLowerCase() === username,
      );
      if (!target) {
        throw CliError.usage(`@${username} is not a member of ${slug}.`);
      }
      if (target.userId === identity.userId) {
        throw CliError.usage("You already own this project.");
      }

      if (!args.yes && isInteractive()) {
        const ok = await confirm({
          message: `Make @${username} the owner of ${slug}? You become an admin. The project key stays the same.`,
          initialValue: false,
        });
        if (isCancel(ok) || !ok) {
          return;
        }
      }

      await client.post<OkResponse>(api.projects.transfer(slug), {
        targetUserId: target.userId,
      });
      if (isJsonMode()) {
        printJson({ transferred: true, project: slug, owner: username });
        return;
      }
      success(`Transferred ${bold(slug)} to ${bold(`@${username}`)}. You are now an admin.`);
    });
  },
});
