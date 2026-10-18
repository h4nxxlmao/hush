import { defineCommand } from "citty";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import { loadProjectDetail, resolveSlug } from "../lib/project-ops";
import { bold, dim, isJsonMode, out, printJson, relativeTime, table } from "../lib/ui";

/** `hush members` — who is in this project and at which role/key version. */
export const membersCommand = defineCommand({
  meta: { name: "members", description: "List project members and pending invites" },
  args: {
    ...globalArgs,
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const client = await requireClient(args);
      const slug = resolveSlug(args.project as string | undefined);
      const detail = await loadProjectDetail(client, slug);

      if (isJsonMode()) {
        printJson({
          project: { slug: detail.project.slug, name: detail.project.name },
          members: detail.members,
          pendingInvites: detail.invites,
        });
        return;
      }

      const rows: string[][] = [["ROLE", "GITHUB", "NAME", "KEY", "SINCE"].map((h) => dim(h))];
      for (const member of detail.members) {
        rows.push([
          member.role,
          member.githubUsername ? `@${member.githubUsername}` : "—",
          member.name ?? "—",
          `v${member.keyVersion}`,
          relativeTime(new Date(member.createdAt)),
        ]);
      }
      out(bold(table(rows)));

      if (detail.invites.length > 0) {
        out();
        const inviteRows: string[][] = [["PENDING", "ROLE", "EXPIRES"].map((h) => dim(h))];
        for (const invite of detail.invites) {
          inviteRows.push([
            `@${invite.githubUsername}`,
            invite.role,
            relativeTime(new Date(invite.expiresAt)),
          ]);
        }
        out(bold(table(inviteRows)));
      }
    });
  },
});
