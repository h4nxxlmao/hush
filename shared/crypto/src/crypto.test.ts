import sodium from "libsodium-wrappers-sumo";
import { beforeEach, describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  buildEnvAad,
  bytesToUtf8,
  computeContentHash,
  createUserKeyMaterial,
  CryptoError,
  derivePublicKey,
  formatRecoveryKey,
  fromBase64,
  generateKdfSalt,
  generateProjectKey,
  generateRecoveryKey,
  normalizeRecoveryKey,
  openEnvFile,
  openPrivateKeyWithPassphrase,
  openPrivateKeyWithRecovery,
  recoveryKeyHash,
  ready,
  sealEnvFile,
  sealPrivateKeyWithPassphrase,
  toBase64,
  toHex,
  utf8ToBytes,
  unwrapProjectKey,
  wrapProjectKeyForMember,
  type UserKeyMaterial,
} from "./index";

const utf8 = (value: string): Uint8Array => utf8ToBytes(value);
const fromUtf8 = (bytes: Uint8Array): string => bytesToUtf8(bytes);

const PARTS = {
  projectId: "proj_abc",
  environmentName: "dev",
  version: 4,
  keyVersion: 1,
} as const;

let material: UserKeyMaterial;

beforeEach(async () => {
  await ready();
  if (!material) {
    material = await createUserKeyMaterial("correct horse battery staple");
  }
});

describe("base32 (RFC 4648)", () => {
  it("matches the RFC test vectors", () => {
    const vectors: Array<[string, string]> = [
      ["", ""],
      ["f", "MY"],
      ["fo", "MZXQ"],
      ["foo", "MZXW6"],
      ["foob", "MZXW6YQ"],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI"],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(utf8(plain))).toBe(encoded);
      expect(fromUtf8(base32Decode(encoded))).toBe(plain);
    }
  });

  it("rejects invalid characters", () => {
    expect(() => base32Decode("MZXW6!")).toThrow(CryptoError);
  });
});

describe("recovery keys", () => {
  it("generates 32-byte keys in grouped base32", async () => {
    const { canonical, display } = await generateRecoveryKey();
    expect(canonical).toMatch(/^[A-Z2-7]{52}$/);
    expect(display).toBe(formatRecoveryKey(canonical));
    expect(display).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4})+$/);
    expect(base32Decode(canonical)).toHaveLength(32);
    expect(base32Encode(base32Decode(canonical))).toBe(canonical);
  });

  it("normalizes user input (case, dashes, confusable characters)", async () => {
    const { canonical, display } = await generateRecoveryKey();
    expect(normalizeRecoveryKey(display.toLowerCase())).toBe(canonical);
    expect(normalizeRecoveryKey(display.replace(/-/g, " "))).toBe(canonical);
  });

  it("hashes to a stable SHA-256 hex", async () => {
    const { canonical } = await generateRecoveryKey();
    const hash = await recoveryKeyHash(canonical);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await recoveryKeyHash(formatRecoveryKey(canonical))).toBe(hash);
  });
});

describe("user key material", () => {
  it("opens with the passphrase and matches the derived public key", async () => {
    const privateKey = await openPrivateKeyWithPassphrase(
      material.encryptedPrivateKey,
      "correct horse battery staple",
      material.kdfSalt,
      material.kdfParams,
    );
    expect(toBase64(privateKey)).toBe(toBase64(material.privateKey));
    expect(await derivePublicKey(privateKey)).toBe(material.publicKey);
  });

  it("fails closed on a wrong passphrase", async () => {
    await expect(
      openPrivateKeyWithPassphrase(
        material.encryptedPrivateKey,
        "wrong passphrase entirely",
        material.kdfSalt,
        material.kdfParams,
      ),
    ).rejects.toMatchObject({ code: "decrypt_failed" });
  });

  it("opens with the recovery key and fails with a wrong one", async () => {
    const privateKey = await openPrivateKeyWithRecovery(
      material.encryptedPrivateKeyRecovery,
      material.recoveryKey,
    );
    expect(toBase64(privateKey)).toBe(toBase64(material.privateKey));

    const other = await generateRecoveryKey();
    await expect(
      openPrivateKeyWithRecovery(material.encryptedPrivateKeyRecovery, other.canonical),
    ).rejects.toMatchObject({ code: "invalid_recovery_key" });
  });

  it("re-seals the private key under a new passphrase (passphrase change)", async () => {
    const newSalt = await generateKdfSalt();
    const sealed = await sealPrivateKeyWithPassphrase(
      material.privateKey,
      "a brand new passphrase",
      newSalt,
      material.kdfParams,
    );
    const reopened = await openPrivateKeyWithPassphrase(
      sealed,
      "a brand new passphrase",
      toBase64(newSalt),
      material.kdfParams,
    );
    expect(toBase64(reopened)).toBe(toBase64(material.privateKey));
    await expect(
      openPrivateKeyWithPassphrase(sealed, "wrong passphrase", toBase64(newSalt), material.kdfParams),
    ).rejects.toMatchObject({ code: "decrypt_failed" });
  });

  it("derives Argon2id params within the shared bounds", () => {
    expect(material.kdfParams.algorithm).toBe("argon2id");
    expect(material.kdfParams.memlimit).toBeGreaterThanOrEqual(64 * 1024 * 1024);
  });
});

describe("project key wrapping", () => {
  it("round-trips a wrapped project key", async () => {
    const projectKey = await generateProjectKey();
    const wrapped = await wrapProjectKeyForMember(projectKey, material.publicKey);
    const unwrapped = await unwrapProjectKey(wrapped, material.publicKey, material.privateKey);
    expect(toBase64(unwrapped)).toBe(toBase64(projectKey));
  });

  it("refuses a wrapped key addressed to someone else", async () => {
    const projectKey = await generateProjectKey();
    const otherKeypair = sodium.crypto_box_keypair();
    const wrappedForOther = await wrapProjectKeyForMember(
      projectKey,
      toBase64(otherKeypair.publicKey),
    );
    await expect(
      unwrapProjectKey(wrappedForOther, material.publicKey, material.privateKey),
    ).rejects.toMatchObject({ code: "invalid_key" });
  });

  it("fails loudly on a tampered wrapped key", async () => {
    const projectKey = await generateProjectKey();
    const wrapped = await wrapProjectKeyForMember(projectKey, material.publicKey);
    const bytes = fromBase64(wrapped);
    bytes[10] = bytes[10]! ^ 0x01;
    await expect(
      unwrapProjectKey(toBase64(bytes), material.publicKey, material.privateKey),
    ).rejects.toMatchObject({ code: "invalid_key" });
  });
});

describe("env file sealing", () => {
  it("round-trips the exact bytes", async () => {
    const projectKey = await generateProjectKey();
    const plaintext = utf8("# comment\nFOO=bar\nQUOTED=\"hello world\"\n");
    const sealed = await sealEnvFile(plaintext, projectKey, PARTS);
    const opened = await openEnvFile(sealed.ciphertext, sealed.nonce, projectKey, PARTS);
    expect(fromUtf8(opened)).toBe(fromUtf8(plaintext));
    expect(sealed.sizeBytes).toBe(plaintext.length);
  });

  it("fails on tampered ciphertext", async () => {
    const projectKey = await generateProjectKey();
    const sealed = await sealEnvFile(utf8("FOO=bar"), projectKey, PARTS);
    const bytes = fromBase64(sealed.ciphertext);
    bytes[2] = bytes[2]! ^ 0x01;
    await expect(
      openEnvFile(toBase64(bytes), sealed.nonce, projectKey, PARTS),
    ).rejects.toMatchObject({ code: "decrypt_failed" });
  });

  it("fails on a tampered nonce", async () => {
    const projectKey = await generateProjectKey();
    const sealed = await sealEnvFile(utf8("FOO=bar"), projectKey, PARTS);
    const nonce = fromBase64(sealed.nonce);
    nonce[0] = nonce[0]! ^ 0x01;
    await expect(
      openEnvFile(sealed.ciphertext, toBase64(nonce), projectKey, PARTS),
    ).rejects.toMatchObject({ code: "decrypt_failed" });
  });

  it("fails on AAD mismatches: wrong project, environment, version or key version", async () => {
    const projectKey = await generateProjectKey();
    const sealed = await sealEnvFile(utf8("FOO=bar"), projectKey, PARTS);
    const mismatches = [
      { ...PARTS, projectId: "proj_other" },
      { ...PARTS, environmentName: "prod" },
      { ...PARTS, version: PARTS.version + 1 },
      { ...PARTS, keyVersion: PARTS.keyVersion + 1 },
    ];
    for (const parts of mismatches) {
      await expect(
        openEnvFile(sealed.ciphertext, sealed.nonce, projectKey, parts),
      ).rejects.toMatchObject({ code: "decrypt_failed" });
    }
  });

  it("fails with the wrong project key", async () => {
    const projectKey = await generateProjectKey();
    const otherKey = await generateProjectKey();
    const sealed = await sealEnvFile(utf8("FOO=bar"), projectKey, PARTS);
    await expect(
      openEnvFile(sealed.ciphertext, sealed.nonce, otherKey, PARTS),
    ).rejects.toMatchObject({ code: "decrypt_failed" });
  });

  it("builds the AAD exactly as specified", () => {
    expect(buildEnvAad(PARTS)).toBe("proj_abc|dev|4|1");
  });
});

describe("content hash", () => {
  it("is deterministic and keyed", async () => {
    const projectKey = await generateProjectKey();
    const otherKey = await generateProjectKey();
    const a = await computeContentHash(utf8("FOO=bar"), projectKey);
    const b = await computeContentHash(utf8("FOO=bar"), projectKey);
    const c = await computeContentHash(utf8("FOO=baz"), projectKey);
    const d = await computeContentHash(utf8("FOO=bar"), otherKey);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("known-answer tests", () => {
  it("SHA-256 of the empty string", async () => {
    await ready();
    expect(toHex(sodium.crypto_hash_sha256(new Uint8Array(0)))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("frozen XChaCha20-Poly1305 ciphertext for a frozen key, nonce and AAD", async () => {
    await ready();
    const key = new Uint8Array(32).fill(7);
    const nonce = new Uint8Array(24).fill(9);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      utf8("FOO=bar\nBAR=baz"),
      buildEnvAad({ projectId: "p1", environmentName: "dev", version: 1, keyVersion: 1 }),
      null,
      nonce,
      key,
    );
    expect(toBase64(ciphertext)).toBe("+D2ttx7LC2i2U1oBChJ9l4ft5lHPfSL2qi6AF+jWGg==");
  });
});
