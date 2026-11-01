import { defineCommand } from "citty";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import { CliError } from "../lib/errors";
import { findMe, loadProjectDetail, resolveSlug } from "../lib/project-ops";
import { loadIdentity } from "../lib/session";
import { readProjectLink, writeProjectLink } from "../lib/state";
import { cyan, info, isJsonMode, printJson, success } from "../lib/ui";

/**
 * `hush use <env>`, persist the default environment for this folder in
 * .hush.json. With no argument, list the environments and mark the current one.
 */
export const useCommand = defineCommand({
  meta: { name: "use", description: "Set the default environment for this folder" },
  args: {
    ...globalArgs,
    env: { type: "positional", description: "Environment name", required: false },
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
    relink: {
      type: "boolean",
      description: "Allow replacing a link that points at a different project",
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

      const requested = (args.env as string | undefined)?.trim();
      if (!requested) {
        const current = readProjectLink()?.defaultEnv;
        if (isJsonMode()) {
          printJson({
            project: detail.project.slug,
            current: current ?? null,
            environments: detail.environments.map((environment) => environment.name),
          });
          return;
        }
        info(`Environments in ${cyan(detail.project.slug)}:`);
        for (const environment of detail.environments) {
          const marker = environment.name === current ? "*" : " ";
          console.log(`  ${marker} ${environment.name}`);
        }
        info("Run `hush use <environment>` to make one the default for this folder.");
        return;
      }

      const environment = detail.environments.find((entry) => entry.name === requested);
      if (!environment) {
        throw CliError.usage(
          `This project has no "${requested}" environment.`,
          `Available: ${detail.environments.map((entry) => entry.name).join(", ") || "none"}.`,
        );
      }

      const existing = readProjectLink();
      if (existing && existing.projectSlug !== detail.project.slug && !args.relink) {
        throw CliError.usage(
          `This folder is linked to ${existing.projectSlug}, not ${detail.project.slug}.`,
          "Pass --relink if you really want to move this folder to another project.",
        );
      }

      writeProjectLink({
        projectId: detail.project.id,
        projectSlug: detail.project.slug,
        defaultEnv: environment.name,
      });
      if (isJsonMode()) {
        printJson({
          project: detail.project.slug,
          defaultEnv: environment.name,
          relinked: Boolean(existing && existing.projectSlug !== detail.project.slug),
        });
        return;
      }
      const relinked = Boolean(existing && existing.projectSlug !== detail.project.slug);
      success(
        relinked
          ? `Relinked this folder from ${existing?.projectSlug} to ${cyan(detail.project.slug)}; default environment ${cyan(environment.name)}.`
          : `Default environment for ${cyan(detail.project.slug)}: ${cyan(environment.name)}.`,
      );
      info("`hush push`, `pull`, `diff`, `run` and `check` now use it unless -e is passed.");
    });
  },
});
