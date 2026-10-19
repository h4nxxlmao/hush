/**
 * Shared constants: limits, roles, API paths, device-flow timings, KDF bounds.
 * Anything the CLI, frontend and backend must agree on lives here.
 */

export const PRODUCT = {
  name: "hush.hanx.pro",
  title: "hush.hanx.pro",
  tagline: "Your .env, everywhere. Encrypted before it leaves your machine.",
  altTaglines: ["Stop pasting secrets into chat.", "Sync your environment, not your secrets."],
  url: "https://hush.hanx.pro",
  apiUrl: "https://api.hush.hanx.pro",
  docsPath: "/docs",
  securityPath: "/security",
  builtByUrl: "https://hanx.pro",
  // Placeholder until the public repo exists. Flagged in MORNING_REPORT.md.
  githubUrl: "https://github.com/h4nxxlmao/hush",
  cliPackage: "@xnah/hush",
  installCommand: "npm i -g @xnah/hush",
  betaNote: "Beta. Don't store credentials you can't rotate.",
} as const;

/** Hard limits. The backend enforces these; clients check them early for a nicer error. */
export const LIMITS = {
  /** Max ciphertext (base64-decoded bytes) accepted per version. */
  MAX_CIPHERTEXT_BYTES: 1_048_576,
  /** Max plaintext env file size the clients will encrypt (same bound, before encryption). */
  MAX_PLAINTEXT_BYTES: 1_048_576,
  MAX_ENVIRONMENTS_PER_PROJECT: 10,
  MAX_PROJECTS_PER_USER: 5,
  MAX_MEMBERS_PER_USER: 5,
  /** Defensive cap on members per project (the free tier caps per-user memberships). */
  MAX_MEMBERS_PER_PROJECT: 25,
  MAX_VERSIONS_KEPT: 50,
  MAX_MESSAGE_LENGTH: 200,
  MAX_PROJECT_NAME_LENGTH: 80,
  MAX_DEVICE_NAME_LENGTH: 60,
  MAX_TOKEN_NAME_LENGTH: 60,
  /** Length of a raw CLI token after the prefix: 32 bytes of base64url randomness. */
  CLI_TOKEN_BYTES: 32,
} as const;

/** Per-plan allowances resolved from the user's tier. Free tier for v1. */
export const PLAN = {
  free: {
    projects: LIMITS.MAX_PROJECTS_PER_USER,
    memberships: LIMITS.MAX_MEMBERS_PER_USER,
    environmentsPerProject: LIMITS.MAX_ENVIRONMENTS_PER_PROJECT,
  },
} as const;

export const ROLES = ["owner", "admin", "member", "readonly"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  readonly: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Roles that can be assigned through an invite. */
export const ASSIGNABLE_ROLES = ["admin", "member", "readonly"] as const;

export const DEFAULT_ENVIRONMENTS = ["dev", "staging", "prod"] as const;

/** RFC 8628 device flow timings and bounds. */
export const DEVICE_FLOW = {
  CODE_TTL_SECONDS: 600,
  POLL_INTERVAL_SECONDS: 5,
  SLOW_DOWN_INCREMENT_SECONDS: 5,
  MAX_POLL_INTERVAL_SECONDS: 60,
  /** User codes are shown as ABCD-EFGH; the alphabet avoids 0/O/1/I confusion. */
  USER_CODE_ALPHABET: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
  USER_CODE_LENGTH: 8,
  DEVICE_CODE_BYTES: 32,
} as const;

/** Key derivation bounds accepted by the server (it never derives, it only sanity-checks). */
export const KDF = {
  ALGORITHM: "argon2id",
  SALT_BYTES: 16,
  KEY_BYTES: 32,
  RECOVERY_KEY_BYTES: 32,
  MIN_OPSLIMIT: 1,
  MAX_OPSLIMIT: 8,
  MIN_MEMLIMIT: 8 * 1024 * 1024,
  MAX_MEMLIMIT: 1024 * 1024 * 1024,
} as const;

export const CRYPTO = {
  NONCE_BYTES: 24,
  PROJECT_KEY_BYTES: 32,
  CONTENT_HASH_BYTES: 32,
} as const;

export const TOKEN_PREFIX = "hush_";

/** Regexes shared by clients and server. */
export const PATTERNS = {
  slug: /^[a-z0-9](?:[a-z0-9-]{0,38})[a-z0-9]$/,
  environmentName: /^[a-z0-9][a-z0-9_-]{0,31}$/i,
  githubUsername: /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i,
  userCode: /^[A-Z0-9]{4}-[A-Z0-9]{4}$/,
} as const;

export const RATE_LIMITS = {
  DEVICE_ATTEMPTS_PER_MINUTE_PER_IP: 10,
  API_CALLS_PER_MINUTE_PER_TOKEN: 60,
  PUSHES_PER_MINUTE_PER_PROJECT: 20,
  WEB_MUTATIONS_PER_MINUTE_PER_IP: 120,
} as const;

export const AUDIT_ACTIONS = [
  "push",
  "pull",
  "rollback",
  "invite",
  "invite_accepted",
  "revoke",
  "rekey",
  "login",
  "token_revoked",
  "project_created",
  "project_deleted",
  "member_role_changed",
  "keys_updated",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * API path builders. The CLI, frontend and backend all use these instead of
 * hand-written strings so a path can only change in one place.
 */
export const api = {
  health: () => "/api/health",
  cron: {
    cleanup: () => "/api/cron/cleanup",
  },
  /** Development-only helper (404 in production): see backend/src/app/api/dev. */
  dev: {
    bootstrap: () => "/api/dev/bootstrap",
  },
  cliDevice: {
    code: () => "/api/cli/device/code",
    token: () => "/api/cli/device/token",
  },
  device: {
    approve: () => "/api/device/approve",
  },
  me: {
    get: () => "/api/me",
    keys: () => "/api/me/keys",
    tokens: () => "/api/me/tokens",
    token: (id: string) => `/api/me/tokens/${encodeURIComponent(id)}`,
  },
  users: {
    byGithub: (username: string) => `/api/users/by-github/${encodeURIComponent(username)}`,
  },
  invites: {
    list: () => "/api/invites",
    accept: () => "/api/invites/accept",
  },
  projects: {
    list: () => "/api/projects",
    create: () => "/api/projects",
    get: (slug: string) => `/api/projects/${encodeURIComponent(slug)}`,
    update: (slug: string) => `/api/projects/${encodeURIComponent(slug)}`,
    environments: (slug: string) => `/api/projects/${encodeURIComponent(slug)}/environments`,
    environment: (slug: string, env: string) =>
      `/api/projects/${encodeURIComponent(slug)}/environments/${encodeURIComponent(env)}`,
    versions: (slug: string, env: string) =>
      `/api/projects/${encodeURIComponent(slug)}/environments/${encodeURIComponent(env)}/versions`,
    version: (slug: string, env: string, n: number) =>
      `/api/projects/${encodeURIComponent(slug)}/environments/${encodeURIComponent(env)}/versions/${n}`,
    members: (slug: string) => `/api/projects/${encodeURIComponent(slug)}/members`,
    member: (slug: string, userId: string) =>
      `/api/projects/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
    audit: (slug: string) => `/api/projects/${encodeURIComponent(slug)}/audit`,
  },
} as const;

/** Custom header every browser mutation from the dashboard must send (CSRF defense-in-depth). */
export const CLIENT_HEADER = "X-Hush-Client";
export const CLIENT_HEADER_VALUE = "web";

export const EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
  CONFLICT: 4,
} as const;
