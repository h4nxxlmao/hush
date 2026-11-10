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
import { loadProjectDetail, resolveSlug } from "../lib/project-ops";
import { isJsonMode, printJson, success } from "../lib/ui";

/** `hush uninvite <id>`, cancel a pending invite. */
export const uninviteCommand = defineCommand({
  meta: { name: "uninvite", description: "Cancel a pending project invite" },
  args: {
    ...globalArgs,
    inviteId: { type: "positional", description: "Invite id from `hush members`", required: true },
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const client = await requireClient(args);
      const slug = resolveSlug(args.project as string | undefined);
      const detail = await loadProjectDetail(client, slug);
      const id = String(args.inviteId).trim();
      const invite = detail.invites.find((entry) => entry.id === id);
      if (!invite) {
        throw CliError.usage(
          `No pending invite with id "${id}".`,
          "Run `hush members` to list pending invites and their ids.",
        );
      }

      if (!args.yes && isInteractive()) {
        const ok = await confirm({
          message: `Cancel the invite for @${invite.githubUsername}?`,
          initialValue: false,
        });
        if (isCancel(ok) || !ok) {
          return;
        }
      }

      await client.del<OkResponse>(api.projects.invite(slug, id));
      if (isJsonMode()) {
        printJson({ cancelled: true, inviteId: id, githubUsername: invite.githubUsername });
        return;
      }
      success(`Cancelled the invite for @${invite.githubUsername}.`);
    });
  },
});
