import { api, type EnvironmentsListResponse, type ProjectListResponse } from "@hush/schemas";
import { defineCommand } from "citty";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import { readProjectLink } from "../lib/state";
import { bold, bytes, dim, info, isJsonMode, out, printJson, relativeTime, table } from "../lib/ui";

/** `hush ls`, every project you belong to, with each environment's latest state. */
export const lsCommand = defineCommand({
  meta: { name: "ls", description: "List projects and environments" },
  args: { ...globalArgs },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const client = await requireClient(args);
      const { projects } = await client.get<ProjectListResponse>(api.projects.list());
      if (projects.length === 0) {
        info("No projects yet. Run `hush init` to create your first one.");
        return;
      }

      const link = readProjectLink();
      const rows: Array<Array<string>> = [
        ["PROJECT", "ENVIRONMENT", "VER", "UPDATED", "SIZE"].map((heading) => dim(heading)),
      ];
      const payload: Array<Record<string, unknown>> = [];

      for (const project of projects) {
        const { environments } = await client.get<EnvironmentsListResponse>(
          api.projects.environments(project.slug),
        );
        payload.push({
          slug: project.slug,
          name: project.name,
          role: project.role,
          environments: environments.map((environment) => ({
            name: environment.name,
            latestVersion: environment.latestVersion,
            lastPushedAt: environment.lastPushedAt,
            lastPushedBy: environment.lastPushedBy,
            sizeBytes: environment.latestSizeBytes,
          })),
        });
        const marker = link?.projectSlug === project.slug ? "*" : " ";
        for (const environment of environments) {
          rows.push([
            `${marker}${project.slug}`,
            environment.name,
            environment.latestVersion > 0 ? `v${environment.latestVersion}` : "-",
            environment.lastPushedAt ? relativeTime(new Date(environment.lastPushedAt)) : "never",
            environment.latestSizeBytes != null ? bytes(environment.latestSizeBytes) : "-",
          ]);
        }
      }

      if (isJsonMode()) {
        printJson({ projects: payload });
        return;
      }
      out(bold(table(rows)));
      if (link) {
        info(`* = linked to this folder (${link.projectSlug}, default env ${link.defaultEnv})`);
      }
    });
  },
});
