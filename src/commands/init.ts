import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { generateProjectKey, wrapProjectKeyForMember } from "@hush/crypto";
import { isCancel, select, text } from "@clack/prompts";
import {
  api,
  type ProjectListResponse,
  type ProjectResponse,
} from "@hush/schemas";
import { defineCommand } from "citty";
import { globalArgs, isInteractive, requireClient, runWithArgs } from "../lib/command";
import { CliError } from "../lib/errors";
import { checkGitignore, ensureGitignoreEntries } from "../lib/gitignore";
import { loadProjectDetail } from "../lib/project-ops";
import { requirePrivateKey } from "../lib/session";
import { readProjectLink, writeProjectLink, PROJECT_LINK_FILE } from "../lib/state";
import { info, isJsonMode, printJson, success, warn } from "../lib/ui";

/**
 * `hush init`, link this folder to a project (or create one).
 *
 * Creating a project also creates its project key, client-side, wrapped for the
 * owner's public key. The server stores the wrapped blob and can never open it.
 * .hush.json holds no secrets: project id, slug, default environment.
 */
export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Create a project or link this folder to an existing one",
  },
  args: {
    ...globalArgs,
    name: { type: "string", description: "Name for a new project" },
    project: { type: "string", description: "Slug of an existing project to link" },
    env: { type: "string", alias: "e", description: "Default environment (default: dev)" },
    "skip-gitignore": {
      type: "boolean",
      description: "Do not touch .gitignore",
      default: false,
    },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const client = await requireClient(args);
      const cwd = process.cwd();

      if (existsSync(resolve(cwd, PROJECT_LINK_FILE))) {
        const link = readProjectLink();
        if (isJsonMode()) {
          printJson({ project: link, alreadyLinked: true });
        } else {
          success(
            `Already linked to ${link?.projectSlug} (default env: ${link?.defaultEnv ?? "dev"}).`,
          );
          info(`Delete ${PROJECT_LINK_FILE} to link a different project.`);
        }
        return;
      }

      const { projects } = await client.get<ProjectListResponse>(api.projects.list());
      let slug: string;
      let defaultEnv = (args.env as string | undefined)?.trim() || "dev";

      const explicitSlug = (args.project as string | undefined)?.trim();
      const explicitName = (args.name as string | undefined)?.trim();

      if (explicitSlug) {
        if (!projects.some((project) => project.slug === explicitSlug)) {
          throw CliError.usage(
            `You are not a member of "${explicitSlug}".`,
            projects.length > 0
              ? `Projects you belong to: ${projects.map((p) => p.slug).join(", ")}`
              : "You have no projects yet, run `hush init` without --project to create one.",
          );
        }
        slug = explicitSlug;
      } else if (explicitName) {
        slug = await createProject(client, explicitName);
      } else {
        if (!isInteractive()) {
          throw CliError.usage(
            "Non-interactive mode needs --name <new project> or --project <existing slug>.",
          );
        }
        if (projects.length === 0) {
          const name = await text({
            message: "Name your first project",
            placeholder: "my-app",
            validate: (value) => (value && value.trim().length > 0 ? undefined : "Required"),
          });
          if (isCancel(name)) {
            throw new CliError("Cancelled.");
          }
          slug = await createProject(client, String(name));
        } else {
          const choice = await select({
            message: "Link this folder to which project?",
            options: [
              ...projects.map((project) => ({
                value: project.slug,
                label: `${project.name} (${project.slug})`,
                hint: `${project.environmentCount} environments · ${project.memberCount} members`,
              })),
              { value: "__new__", label: "Create a new project" },
            ],
          });
          if (isCancel(choice)) {
            throw new CliError("Cancelled.");
          }
          if (choice === "__new__") {
            const name = await text({
              message: "Name your new project",
              placeholder: "my-app",
              validate: (value) => (value && value.trim().length > 0 ? undefined : "Required"),
            });
            if (isCancel(name)) {
              throw new CliError("Cancelled.");
            }
            slug = await createProject(client, String(name));
          } else {
            slug = String(choice);
          }
        }
      }

      const detail = await loadProjectDetail(client, slug);
      const envNames = detail.environments.map((env) => env.name);
      if (!envNames.includes(defaultEnv)) {
        warn(
          `Project has no "${defaultEnv}" environment, defaulting to "${envNames[0] ?? "dev"}".`,
        );
        defaultEnv = envNames[0] ?? "dev";
      }

      writeProjectLink(
        { projectId: detail.project.id, projectSlug: detail.project.slug, defaultEnv },
        cwd,
      );

      let gitignoreAdded: string[] = [];
      if (!args["skip-gitignore"]) {
        const status = checkGitignore(cwd);
        if (!status.covered) {
          const result = ensureGitignoreEntries(cwd);
          gitignoreAdded = result.added;
          if (!isJsonMode()) {
            success(`Added ${result.added.join(", ")} to .gitignore`);
          }
        } else if (!isJsonMode()) {
          info(".gitignore already ignores .env files.");
        }
      }

      if (isJsonMode()) {
        printJson({
          linked: { ...detail.project, defaultEnv },
          environments: envNames,
          gitignoreAdded,
        });
        return;
      }

      success(`Linked ${cwd} to ${detail.project.slug} (default env: ${defaultEnv}).`);
      info(`Wrote ${PROJECT_LINK_FILE}, no secrets in it; commit it so teammates link instantly.`);
      info(`Next: hush push -e ${defaultEnv}`);
    });
  },
});

async function createProject(
  client: Awaited<ReturnType<typeof requireClient>>,
  name: string,
): Promise<string> {
  // The project key is generated here. Only its sealed form ever leaves.
  const { publicKey } = await requirePrivateKey(client, { prompt: true });
  const projectKey = await generateProjectKey();
  const wrappedProjectKey = await wrapProjectKeyForMember(projectKey, publicKey);
  const { project } = await client.post<ProjectResponse>(api.projects.create(), {
    name,
    wrappedProjectKey,
  });
  if (!isJsonMode()) {
    info(`Created project "${project.name}" with dev/staging/prod environments.`);
  }
  return project.slug;
}
