import { z } from "zod";
import { ASSIGNABLE_ROLES, DEVICE_FLOW, LIMITS, TOKEN_PREFIX } from "./constants";
import {
  auditEntrySchema,
  base64,
  cliTokenSchema,
  deviceCodeInfoSchema,
  environmentNameSchema,
  environmentSchema,
  envVersionSchema,
  envVersionWithCiphertextSchema,
  githubUsernameSchema,
  hex,
  inviteSchema,
  isoDate,
  kdfParamsSchema,
  nameSchema,
  projectMemberSchema,
  projectSchema,
  publicKeySchema,
  roleSchema,
  slugSchema,
  userCodeSchema,
  userProfileSchema,
  wrappedKeySchema,
} from "./entities";

const MAX_B64_CIPHERTEXT = Math.ceil((LIMITS.MAX_CIPHERTEXT_BYTES * 4) / 3) + 4;

export const ciphertextSchema = z.string().min(1).max(MAX_B64_CIPHERTEXT);
export const nonceSchema = z
  .string()
  .regex(/^[A-Za-z0-9+/=_-]+$/, "invalid base64")
  .min(24)
  .max(64);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const errorCodeSchema = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "validation",
  "rate_limited",
  "payload_too_large",
  "limit_exceeded",
  "internal",
  "authorization_pending",
  "slow_down",
  "access_denied",
  "expired_token",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  time: isoDate,
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// ---------------------------------------------------------------------------
// Device flow (RFC 8628) - used by `hush login`
// ---------------------------------------------------------------------------

export const deviceCodeRequestSchema = z.object({
  /** Shown on the approval page so a human knows which machine is asking. */
  deviceName: z.string().trim().min(1).max(LIMITS.MAX_DEVICE_NAME_LENGTH).optional(),
});
export type DeviceCodeRequest = z.infer<typeof deviceCodeRequestSchema>;

export const deviceCodeResponseSchema = z.object({
  deviceCode: z.string().min(16),
  userCode: userCodeSchema,
  verificationUri: z.string(),
  verificationUriComplete: z.string(),
  expiresIn: z.number().int().positive(),
  interval: z.number().int().positive(),
});
export type DeviceCodeResponse = z.infer<typeof deviceCodeResponseSchema>;

export const deviceTokenRequestSchema = z.object({
  deviceCode: z.string().min(16),
});
export type DeviceTokenRequest = z.infer<typeof deviceTokenRequestSchema>;

export const deviceTokenResponseSchema = z.object({
  accessToken: z.string().startsWith(TOKEN_PREFIX),
  tokenName: z.string(),
  hasKeys: z.boolean(),
  user: userProfileSchema.pick({
    id: true,
    githubUsername: true,
    name: true,
    avatarUrl: true,
  }),
});
export type DeviceTokenResponse = z.infer<typeof deviceTokenResponseSchema>;

export const deviceApproveRequestSchema = z.object({
  userCode: userCodeSchema,
  approve: z.boolean(),
});
export type DeviceApproveRequest = z.infer<typeof deviceApproveRequestSchema>;

export const deviceApproveResponseSchema = z.object({
  status: z.enum(["approved", "denied"]),
  userCode: userCodeSchema,
});
export type DeviceApproveResponse = z.infer<typeof deviceApproveResponseSchema>;

export const deviceInfoResponseSchema = z.object({
  device: deviceCodeInfoSchema,
});
export type DeviceInfoResponse = z.infer<typeof deviceInfoResponseSchema>;

export const DEFAULT_DEVICE_INTERVAL = DEVICE_FLOW.POLL_INTERVAL_SECONDS;

// ---------------------------------------------------------------------------
// Account: profile, keys, tokens
// ---------------------------------------------------------------------------

export const meResponseSchema = z.object({
  user: userProfileSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const meKeysSchema = z.object({
  publicKey: publicKeySchema,
  /** Private key sealed with a passphrase-derived key; nonce is prefixed to the blob. */
  encryptedPrivateKey: base64,
  /** Second copy of the private key sealed under the recovery key. */
  encryptedPrivateKeyRecovery: base64,
  kdfSalt: base64,
  kdfParams: kdfParamsSchema,
  /** SHA-256 of the canonical recovery key, for verification only. */
  recoveryKeyHash: hex,
  updatedAt: isoDate,
});
export type MeKeys = z.infer<typeof meKeysSchema>;

export const meKeysUploadSchema = meKeysSchema.omit({ updatedAt: true }).extend({
  // The sealed private key is a few dozen bytes; these bounds stop a single
  // request from persisting megabyte-scale blobs in the users row.
  encryptedPrivateKey: base64.max(4_096),
  encryptedPrivateKeyRecovery: base64.max(4_096),
  kdfSalt: base64.max(128),
  recoveryKeyHash: hex.max(128),
});
export type MeKeysUpload = z.infer<typeof meKeysUploadSchema>;

export const meKeysResponseSchema = z.object({
  keys: meKeysSchema.nullable(),
});
export type MeKeysResponse = z.infer<typeof meKeysResponseSchema>;

export const meTokensResponseSchema = z.object({
  tokens: z.array(cliTokenSchema),
});
export type MeTokensResponse = z.infer<typeof meTokensResponseSchema>;

// ---------------------------------------------------------------------------
// Users (public key lookup for invites)
// ---------------------------------------------------------------------------

export const userLookupResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    githubUsername: z.string(),
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    publicKey: publicKeySchema,
  }),
});
export type UserLookupResponse = z.infer<typeof userLookupResponseSchema>;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const createProjectRequestSchema = z.object({
  name: nameSchema,
  slug: slugSchema.optional(),
  /**
   * The project key, sealed to the creator's public key. Generated client-side:
   * the server can store this but never opens it.
   */
  wrappedProjectKey: wrappedKeySchema,
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z.object({
  name: nameSchema.optional(),
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const projectListResponseSchema = z.object({
  projects: z.array(projectSchema),
});
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

export const projectResponseSchema = z.object({
  project: projectSchema,
});
export type ProjectResponse = z.infer<typeof projectResponseSchema>;

export const projectDetailResponseSchema = z.object({
  project: projectSchema,
  environments: z.array(environmentSchema),
  members: z.array(projectMemberSchema),
  /** Pending invites; only present for admin/owner roles. */
  invites: z.array(inviteSchema),
  /**
   * The requesting member's own sealed project key. Sealed to their public key,
   * so exposing it to them changes nothing, and every client needs it to work.
   */
  myKey: z
    .object({
      wrappedProjectKey: wrappedKeySchema,
      keyVersion: z.number().int().positive(),
    })
    .nullable(),
});
export type ProjectDetailResponse = z.infer<typeof projectDetailResponseSchema>;

export const createEnvironmentRequestSchema = z.object({
  name: environmentNameSchema,
});
export type CreateEnvironmentRequest = z.infer<typeof createEnvironmentRequestSchema>;

export const environmentResponseSchema = z.object({
  environment: environmentSchema,
});
export type EnvironmentResponse = z.infer<typeof environmentResponseSchema>;

export const environmentsListResponseSchema = z.object({
  environments: z.array(environmentSchema),
});
export type EnvironmentsListResponse = z.infer<typeof environmentsListResponseSchema>;

export const createEnvironmentResponseSchema = z.object({
  environment: environmentSchema,
});
export type CreateEnvironmentResponse = z.infer<typeof createEnvironmentResponseSchema>;

export const memberResponseSchema = z.object({
  member: projectMemberSchema,
});
export type MemberResponse = z.infer<typeof memberResponseSchema>;

// ---------------------------------------------------------------------------
// Versions: push / pull / list / rollback
// ---------------------------------------------------------------------------

export const pushVersionRequestSchema = z.object({
  /** Version the client last saw. The server rejects pushes that are behind (409). */
  baseVersion: z.number().int().nonnegative(),
  ciphertext: ciphertextSchema,
  nonce: nonceSchema,
  keyVersion: z.number().int().positive().max(1_000_000),
  sizeBytes: z.number().int().nonnegative().max(LIMITS.MAX_CIPHERTEXT_BYTES),
  contentHash: hex.max(128),
  message: z.string().trim().max(LIMITS.MAX_MESSAGE_LENGTH).nullish(),
  /**
   * Rollback marker: the version whose content this push re-creates. The client
   * re-encrypts (the AAD binds the version number), so this is only for the audit trail.
   */
  rollbackOf: z.number().int().positive().nullish(),
});
export type PushVersionRequest = z.infer<typeof pushVersionRequestSchema>;

export const versionResponseSchema = z.object({
  version: envVersionSchema,
});
export type VersionResponse = z.infer<typeof versionResponseSchema>;

export const latestVersionResponseSchema = z.object({
  environment: environmentSchema,
  version: envVersionWithCiphertextSchema,
});
export type LatestVersionResponse = z.infer<typeof latestVersionResponseSchema>;

export const versionDetailResponseSchema = z.object({
  environment: environmentSchema,
  version: envVersionWithCiphertextSchema,
});
export type VersionDetailResponse = z.infer<typeof versionDetailResponseSchema>;

export const versionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.number().int().positive().optional(),
});
export type VersionsQuery = z.infer<typeof versionsQuerySchema>;

export const versionsListResponseSchema = z.object({
  versions: z.array(envVersionSchema),
  nextCursor: z.number().int().positive().nullable(),
});
export type VersionsListResponse = z.infer<typeof versionsListResponseSchema>;

export const rollbackRequestSchema = z.object({
  fromVersion: z.number().int().positive(),
  baseVersion: z.number().int().nonnegative(),
  ciphertext: ciphertextSchema,
  nonce: nonceSchema,
  keyVersion: z.number().int().positive().max(1_000_000),
  sizeBytes: z.number().int().nonnegative().max(LIMITS.MAX_CIPHERTEXT_BYTES),
  contentHash: hex.max(128),
  message: z.string().trim().max(LIMITS.MAX_MESSAGE_LENGTH).nullish(),
});
export type RollbackRequest = z.infer<typeof rollbackRequestSchema>;

// ---------------------------------------------------------------------------
// Members, invites, rekey
// ---------------------------------------------------------------------------

export const inviteMemberRequestSchema = z.object({
  githubUsername: githubUsernameSchema,
  role: z.enum(ASSIGNABLE_ROLES).default("member"),
  /** The project key sealed to the invitee's public key (prepared client-side). */
  wrappedProjectKey: wrappedKeySchema,
});
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;

export const inviteResponseSchema = z.object({
  invite: inviteSchema,
  /** Raw invite token, shown once to the inviter so it can be shared as a link. */
  token: z.string(),
});
export type InviteResponse = z.infer<typeof inviteResponseSchema>;

export const invitesListResponseSchema = z.object({
  invites: z.array(inviteSchema),
});
export type InvitesListResponse = z.infer<typeof invitesListResponseSchema>;

export const inviteAcceptRequestSchema = z
  .object({
    /** Dashboard path: accept one of my pending invites by id. */
    inviteId: z.string().min(1).optional(),
    /** Shared-link path: accept by raw token. */
    token: z.string().min(16).max(200).optional(),
  })
  .refine((value) => Boolean(value.inviteId) !== Boolean(value.token), {
    message: "Provide exactly one of inviteId or token.",
  });
export type InviteAcceptRequest = z.infer<typeof inviteAcceptRequestSchema>;

export const inviteAcceptResponseSchema = z.object({
  project: projectSchema,
  member: projectMemberSchema,
});
export type InviteAcceptResponse = z.infer<typeof inviteAcceptResponseSchema>;

export const rekeyEnvironmentEntrySchema = z.object({
  environmentId: z.string().min(1),
  baseVersion: z.number().int().nonnegative(),
  ciphertext: ciphertextSchema,
  nonce: nonceSchema,
  sizeBytes: z.number().int().nonnegative().max(LIMITS.MAX_CIPHERTEXT_BYTES),
  contentHash: hex.max(128),
});
export type RekeyEnvironmentEntry = z.infer<typeof rekeyEnvironmentEntrySchema>;

export const rekeyMemberEntrySchema = z.object({
  userId: z.string().min(1),
  wrappedProjectKey: wrappedKeySchema,
});
export type RekeyMemberEntry = z.infer<typeof rekeyMemberEntrySchema>;

export const rekeyRequestSchema = z.object({
  revokedUserId: z.string().min(1),
  keyVersion: z.number().int().min(2),
  environments: z.array(rekeyEnvironmentEntrySchema).max(LIMITS.MAX_ENVIRONMENTS_PER_PROJECT),
  members: z.array(rekeyMemberEntrySchema).max(LIMITS.MAX_MEMBERS_PER_PROJECT),
});
export type RekeyRequest = z.infer<typeof rekeyRequestSchema>;

export const removeMemberResponseSchema = z.object({
  project: projectSchema,
  keyVersion: z.number().int().positive(),
});
export type RemoveMemberResponse = z.infer<typeof removeMemberResponseSchema>;

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: isoDate.optional(),
  action: z.string().max(40).optional(),
  env: z.string().max(32).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditResponseSchema = z.object({
  entries: z.array(auditEntrySchema),
  nextCursor: isoDate.nullable(),
});
export type AuditResponse = z.infer<typeof auditResponseSchema>;

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

export const cronCleanupResponseSchema = z.object({
  ok: z.boolean(),
  deletedDeviceCodes: z.number().int().nonnegative(),
  expiredInvites: z.number().int().nonnegative(),
});
export type CronCleanupResponse = z.infer<typeof cronCleanupResponseSchema>;

// ---------------------------------------------------------------------------
// Version metadata
// ---------------------------------------------------------------------------

export const okResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponseSchema>;

export const API_VERSION = "0.1.0";
export const API_CLIENT_HEADER = "X-Hush-Client";
export const roleUpdateRequestSchema = z.object({ role: roleSchema });
export type RoleUpdateRequest = z.infer<typeof roleUpdateRequestSchema>;
