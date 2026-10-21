import { bytesToUtf8, openEnvFile, unwrapProjectKey } from "@hush/crypto";
import {
  api,
  roleAtLeast,
  type Environment,
  type LatestVersionResponse,
  type ProjectDetailResponse,
  type ProjectMember,
  type Role,
  type VersionDetailResponse,
} from "@hush/schemas";
import { HushApiError, type ApiClient } from "./api";
import { CliError } from "./errors";
import { readProjectLink } from "./state";

/**
 * Project context helpers shared by the commands: load a project, pick an
 * environment, check the role, unwrap the project key, fetch versions.
 */

export async function loadProjectDetail(
  client: ApiClient,
  slug: string,
): Promise<ProjectDetailResponse> {
  return client.get<ProjectDetailResponse>(api.projects.get(slug));
}

export function resolveSlug(flagValue: string | undefined): string {
  if (flagValue) {
    return flagValue;
  }
  const link = readProjectLink();
  if (link) {
    return link.projectSlug;
  }
  throw CliError.usage(
    "No project linked here.",
    "Run `hush init` in this folder, or pass --project <slug>.",
  );
}

export function pickEnvironment(detail: ProjectDetailResponse, name?: string): Environment {
  const link = readProjectLink();
  const wanted = name?.trim() || link?.defaultEnv || "dev";
  const found = detail.environments.find((env) => env.name === wanted);
  if (!found) {
    const available = detail.environments.map((env) => env.name).join(", ") || "none";
    throw CliError.usage(
      `This project has no "${wanted}" environment.`,
      `Available: ${available}. Create one in the dashboard, or pass -e <name>.`,
    );
  }
  return found;
}

export function requireRole(member: ProjectMember, min: Role): void {
  if (!roleAtLeast(member.role, min)) {
    throw CliError.auth(
      `Your role (${member.role}) cannot do this, it needs ${min} or higher.`,
      "Ask a project admin for a role change.",
    );
  }
}

export function findMe(detail: ProjectDetailResponse, userId: string): ProjectMember {
  const me = detail.members.find((member) => member.userId === userId);
  if (!me) {
    throw CliError.auth(
      "You are not a member of this project.",
      "Ask for an invite, or run `hush init` to create your own project.",
    );
  }
  return me;
}

/**
 * Unwrap the project key. The wrapped blob arrives in `detail.myKey`, it is
 * sealed to this user's public key, so only their private key can open it.
 */
export async function openProjectKey(
  detail: ProjectDetailResponse,
  privateKey: Uint8Array,
  publicKey: string,
): Promise<{ projectKey: Uint8Array; keyVersion: number }> {
  if (!detail.myKey) {
    throw CliError.auth(
      "You have no wrapped key for this project.",
      "Ask a project admin to invite you again.",
    );
  }
  const projectKey = await unwrapProjectKey(
    detail.myKey.wrappedProjectKey,
    publicKey,
    privateKey,
  );
  return { projectKey, keyVersion: detail.myKey.keyVersion };
}

export async function fetchLatest(
  client: ApiClient,
  slug: string,
  environmentName: string,
): Promise<LatestVersionResponse> {
  return client.get<LatestVersionResponse>(api.projects.environment(slug, environmentName));
}

/** Latest version, or null when the environment has never been pushed. */
export async function fetchLatestOrNull(
  client: ApiClient,
  slug: string,
  environmentName: string,
): Promise<LatestVersionResponse | null> {
  try {
    return await fetchLatest(client, slug, environmentName);
  } catch (error) {
    if (error instanceof HushApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/** Decrypt a fetched version. The AAD binds project/env/version/keyVersion. */
export interface ExpectedVersionSlot {
  environmentName?: string;
  version?: number;
}

export async function decryptVersion(
  projectId: string,
  response: LatestVersionResponse,
  projectKey: Uint8Array,
  expected: ExpectedVersionSlot = {},
): Promise<string> {
  // The AAD must describe the slot the user asked for, not merely the slot the
  // server says the blob belongs to. Otherwise a hostile server can serve
  // another environment's correctly labelled ciphertext while the CLI reports
  // the requested environment.
  if (expected.environmentName && response.environment.name !== expected.environmentName) {
    throw new CliError(
      `The server returned "${response.environment.name}", not "${expected.environmentName}".`,
      3,
      "Refusing to decrypt ciphertext for the wrong environment.",
    );
  }
  if (expected.version !== undefined && response.version.version !== expected.version) {
    throw new CliError(
      `The server returned v${response.version.version}, not v${expected.version}.`,
      3,
      "Refusing to decrypt ciphertext for the wrong version.",
    );
  }
  const bytes = await openEnvFile(
    response.version.ciphertext,
    response.version.nonce,
    projectKey,
    {
      projectId,
      environmentName: response.environment.name,
      version: response.version.version,
      keyVersion: response.version.keyVersion,
    },
  );
  return bytesToUtf8(bytes);
}

export async function fetchVersion(
  client: ApiClient,
  slug: string,
  environmentName: string,
  version: number,
): Promise<VersionDetailResponse> {
  return client.get<VersionDetailResponse>(
    api.projects.version(slug, environmentName, version),
  );
}
