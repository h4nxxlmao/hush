import { z } from "zod";
import { AUDIT_ACTIONS, KDF, LIMITS, PATTERNS, ROLES } from "./constants";

/** Accepts any string Date.parse can handle; the wire format is ISO 8601. */
export const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "invalid ISO date");

export const base64 = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9+/=_-]+$/, "invalid base64");

export const hex = z.string().regex(/^[0-9a-fA-F]+$/, "invalid hex");

export const slugSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(PATTERNS.slug, "lowercase letters, numbers and dashes only");

export const environmentNameSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(PATTERNS.environmentName, "letters, numbers, dash and underscore only");

export const githubUsernameSchema = z
  .string()
  .regex(PATTERNS.githubUsername, "valid GitHub username required");

export const userCodeSchema = z.string().regex(PATTERNS.userCode, "user codes look like ABCD-EFGH");

export const roleSchema = z.enum(ROLES);

export const kdfParamsSchema = z.object({
  algorithm: z.literal(KDF.ALGORITHM).default(KDF.ALGORITHM),
  opslimit: z.number().int().min(KDF.MIN_OPSLIMIT).max(KDF.MAX_OPSLIMIT),
  memlimit: z.number().int().min(KDF.MIN_MEMLIMIT).max(KDF.MAX_MEMLIMIT),
});
export type KdfParams = z.infer<typeof kdfParamsSchema>;

/** An X25519 public key, base64-encoded (32 bytes -> 44 chars). */
export const publicKeySchema = base64.max(100);

/** A private key sealed with crypto_box_seal against a public key (48 bytes -> 64 chars). */
export const wrappedKeySchema = base64.max(200);

export const userProfileSchema = z.object({
  id: z.string(),
  githubUsername: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  hasKeys: z.boolean(),
  createdAt: isoDate,
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const publicKeyInfoSchema = z.object({
  userId: z.string(),
  githubUsername: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  publicKey: publicKeySchema,
});
export type PublicKeyInfo = z.infer<typeof publicKeyInfoSchema>;

export const projectSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  /** Role of the requesting user in this project. */
  role: roleSchema,
  environmentCount: z.number().int().nonnegative(),
  memberCount: z.number().int().nonnegative(),
  lastPushAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type Project = z.infer<typeof projectSchema>;

export const projectMemberSchema = z.object({
  userId: z.string(),
  githubUsername: z.string().nullable(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: roleSchema,
  keyVersion: z.number().int().positive(),
  /** Public key, needed to re-wrap the project key on rotate (never a secret). */
  publicKey: publicKeySchema.nullable(),
  createdAt: isoDate,
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;

export const environmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  latestVersion: z.number().int().nonnegative(),
  lastPushedAt: isoDate.nullable(),
  lastPushedBy: z.string().nullable(),
  latestSizeBytes: z.number().int().nonnegative().nullable(),
  createdAt: isoDate,
});
export type Environment = z.infer<typeof environmentSchema>;

export const versionAuthorSchema = z
  .object({
    userId: z.string(),
    githubUsername: z.string().nullable(),
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  })
  .nullable();

export const envVersionSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  keyVersion: z.number().int().positive(),
  sizeBytes: z.number().int().nonnegative(),
  /** Keyed hash of the plaintext: lets clients spot "no changes" without decrypting. */
  contentHash: hex,
  message: z.string().nullable(),
  author: versionAuthorSchema,
  createdAt: isoDate,
});
export type EnvVersion = z.infer<typeof envVersionSchema>;

export const envVersionWithCiphertextSchema = envVersionSchema.extend({
  ciphertext: base64,
  nonce: base64,
});
export type EnvVersionWithCiphertext = z.infer<typeof envVersionWithCiphertextSchema>;

export const cliTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  lastUsedAt: isoDate.nullable(),
  createdAt: isoDate,
  revokedAt: isoDate.nullable(),
});
export type CliToken = z.infer<typeof cliTokenSchema>;

export const auditActorSchema = versionAuthorSchema;

export const auditEntrySchema = z.object({
  id: z.string(),
  action: z.enum(AUDIT_ACTIONS),
  actor: auditActorSchema,
  environmentName: z.string().nullable(),
  version: z.number().int().positive().nullable(),
  ip: z.string().nullable(),
  createdAt: isoDate,
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const inviteSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectSlug: z.string(),
  projectName: z.string(),
  role: roleSchema,
  githubUsername: z.string(),
  invitedBy: auditActorSchema,
  expiresAt: isoDate,
  acceptedAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type Invite = z.infer<typeof inviteSchema>;

export const deviceStatusSchema = z.enum(["pending", "approved", "denied", "expired"]);
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

export const deviceCodeInfoSchema = z.object({
  userCode: userCodeSchema,
  status: deviceStatusSchema,
  deviceName: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: isoDate,
  expiresAt: isoDate,
});
export type DeviceCodeInfo = z.infer<typeof deviceCodeInfoSchema>;

/** What the frontend receives for the logged-in user (web session view). */
export const webSessionUserSchema = z.object({
  id: z.string(),
  githubUsername: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  hasKeys: z.boolean(),
});
export type WebSessionUser = z.infer<typeof webSessionUserSchema>;

export const nameSchema = z.string().trim().min(1).max(LIMITS.MAX_PROJECT_NAME_LENGTH);
export const messageSchema = z.string().trim().max(LIMITS.MAX_MESSAGE_LENGTH);
