import { join } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { api, type OkResponse } from "@hush/schemas";
import { defineCommand } from "citty";
import {
  globalArgs,
  requireClient,
  requireInteractive,
  runWithArgs,
} from "../lib/command";
import { CliError } from "../lib/errors";
import { resolveSlug } from "../lib/project-ops";
import { PROJECT_LINK_FILE, readProjectLink, removeFile } from "../lib/state";
import { info, isJsonMode, printJson, success } from "../lib/ui";

/** `hush leave`, remove yourself from a project without asking an admin. */
export const leaveCommand = defineCommand({
  meta: { name: "leave", description: "Leave a project (non-owners)" },
  args: {
    ...globalArgs,
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const client = await requireClient(args);
      const slug = resolveSlug(args.project as string | undefined);

      if (!args.yes) {
        requireInteractive("confirm leaving a project");
        const ok = await confirm({
          message: `Leave ${slug}? You keep any ciphertext already on this machine, but lose access to future versions.`,
          initialValue: false,
        });
        if (isCancel(ok) || !ok) {
          throw new CliError("Cancelled.");
        }
      }

      await client.post<OkResponse>(api.projects.leave(slug));
      const link = readProjectLink();
      if (link?.projectSlug === slug) {
        removeFile(join(process.cwd(), PROJECT_LINK_FILE));
      }

      if (isJsonMode()) {
        printJson({ left: true, project: slug, linkRemoved: link?.projectSlug === slug });
        return;
      }
      success(`Left ${slug}.`);
      info("An owner or admin can invite you again later.");
    });
  },
});
