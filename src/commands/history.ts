import { api, type VersionsListResponse } from "@hush/schemas";
import { defineCommand } from "citty";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import { fetchLatestOrNull, findMe, loadProjectDetail, pickEnvironment, resolveSlug } from "../lib/project-ops";
import { loadIdentity } from "../lib/session";
import { bold, bytes, dim, info, isJsonMode, out, printJson, relativeTime, table } from "../lib/ui";

/** `hush history` — who pushed what, when, and how big it was. */
export const historyCommand = defineCommand({
  meta: { name: "history", description: "Show version history for an environment" },
  args: {
    ...globalArgs,
    env: { type: "string", alias: "e", description: "Environment name" },
    project: { type: "string", description: "Project slug (defaults to the linked project)" },
    limit: { type: "string", description: "How many versions to show (default 20)" },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const client = await requireClient(args);
      const slug = resolveSlug(args.project as string | undefined);
      const detail = await loadProjectDetail(client, slug);
      const identity = await loadIdentity(client);
      findMe(detail, identity.userId);
      const environment = pickEnvironment(detail, args.env as string | undefined);

      const limit = Math.min(Math.max(Number(args.limit ?? 20) || 20, 1), 100);
      const { versions } = await client.get<VersionsListResponse>(
        api.projects.versions(slug, environment.name),
        { limit },
      );
      const latest = await fetchLatestOrNull(client, slug, environment.name);

      if (isJsonMode()) {
        printJson({ project: slug, environment: environment.name, versions });
        return;
      }

      if (versions.length === 0) {
        info(`No versions in ${environment.name} yet.`);
        return;
      }

      const rows: string[][] = [["VER", "WHEN", "BY", "SIZE", "KEY", "MESSAGE"].map((h) => dim(h))];
      for (const version of versions) {
        rows.push([
          `v${version.version}`,
          relativeTime(new Date(version.createdAt)),
          version.author?.githubUsername
            ? `@${version.author.githubUsername}`
            : version.author?.name ?? "unknown",
          bytes(version.sizeBytes),
          `k${version.keyVersion}`,
          version.message ?? "",
        ]);
      }
      out(bold(table(rows)));
      if (latest) {
        info(`Latest: v${latest.version.version} — the server has only ever held ciphertext.`);
      }
    });
  },
});
