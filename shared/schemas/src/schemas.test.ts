import { describe, expect, it } from "vitest";
import {
  api,
  apiErrorSchema,
  createProjectRequestSchema,
  environmentNameSchema,
  inviteMemberRequestSchema,
  LIMITS,
  pushVersionRequestSchema,
  roleAtLeast,
  ROLE_RANK,
  slugSchema,
  userCodeSchema,
} from "./index";

const B64_NONCE = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 24 bytes of zeros in base64
const WRAPPED_KEY = "A".repeat(64); // a sealed project key (48 bytes base64)

describe("constants", () => {
  it("orders roles", () => {
    expect(ROLE_RANK.readonly).toBeLessThan(ROLE_RANK.member);
    expect(ROLE_RANK.member).toBeLessThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.owner);
    expect(roleAtLeast("admin", "member")).toBe(true);
    expect(roleAtLeast("readonly", "member")).toBe(false);
    expect(roleAtLeast("owner", "owner")).toBe(true);
  });

  it("builds api paths with encoding", () => {
    expect(api.projects.environment("my proj", "dev")).toBe(
      "/api/projects/my%20proj/environments/dev",
    );
    expect(api.projects.version("p", "prod", 12)).toBe(
      "/api/projects/p/environments/prod/versions/12",
    );
    expect(api.users.byGithub("octo cat")).toBe("/api/users/by-github/octo%20cat");
  });

  it("keeps sane limits", () => {
    expect(LIMITS.MAX_CIPHERTEXT_BYTES).toBe(1_048_576);
    expect(LIMITS.MAX_VERSIONS_KEPT).toBe(50);
  });
});

describe("entity validation", () => {
  it("accepts dashed user codes only", () => {
    expect(userCodeSchema.safeParse("ABCD-EFGH").success).toBe(true);
    expect(userCodeSchema.safeParse("ABCDEFGH").success).toBe(false);
    expect(userCodeSchema.safeParse("abcd-efgh").success).toBe(false);
  });

  it("validates slugs", () => {
    expect(slugSchema.safeParse("my-project").success).toBe(true);
    expect(slugSchema.safeParse("-bad").success).toBe(false);
    expect(slugSchema.safeParse("Bad_Case").success).toBe(false);
    expect(slugSchema.safeParse("a").success).toBe(false);
  });

  it("validates environment names", () => {
    expect(environmentNameSchema.safeParse("dev").success).toBe(true);
    expect(environmentNameSchema.safeParse("staging_2").success).toBe(true);
    expect(environmentNameSchema.safeParse("prod east").success).toBe(false);
  });

  it("rejects owner as an invite role", () => {
    expect(
      inviteMemberRequestSchema.safeParse({
        githubUsername: "octocat",
        wrappedProjectKey: WRAPPED_KEY,
      }).success,
    ).toBe(true);
    expect(
      inviteMemberRequestSchema.safeParse({
        githubUsername: "octocat",
        role: "owner",
        wrappedProjectKey: WRAPPED_KEY,
      }).success,
    ).toBe(false);
  });
});

describe("push request", () => {
  const valid = {
    baseVersion: 3,
    ciphertext: "z".repeat(64),
    nonce: B64_NONCE,
    keyVersion: 1,
    sizeBytes: 120,
    contentHash: "a".repeat(64),
  };

  it("accepts a valid push", () => {
    const parsed = pushVersionRequestSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("rejects negative base versions and oversized payloads", () => {
    expect(pushVersionRequestSchema.safeParse({ ...valid, baseVersion: -1 }).success).toBe(false);
    expect(
      pushVersionRequestSchema.safeParse({
        ...valid,
        ciphertext: "z".repeat(Math.ceil((LIMITS.MAX_CIPHERTEXT_BYTES * 4) / 3) + 8),
      }).success,
    ).toBe(false);
  });
});

describe("error shape", () => {
  it("parses standard errors", () => {
    const parsed = apiErrorSchema.safeParse({
      error: { code: "conflict", message: "Your copy is behind (local 3, remote 5)." },
    });
    expect(parsed.success).toBe(true);
    expect(
      apiErrorSchema.safeParse({ error: { code: "nope", message: "bad" } }).success,
    ).toBe(false);
  });
});

describe("create project request", () => {
  it("does not require a slug but does require the wrapped project key", () => {
    expect(
      createProjectRequestSchema.safeParse({ name: "My Project", wrappedProjectKey: WRAPPED_KEY })
        .success,
    ).toBe(true);
    // The client must seal the project key before the server can store it.
    expect(createProjectRequestSchema.safeParse({ name: "My Project" }).success).toBe(false);
  });
});
