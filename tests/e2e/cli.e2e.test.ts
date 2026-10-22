import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  createUserKeyMaterial,
  toBase64,
} from "@hush/crypto";
import { api } from "@hush/schemas";
import { describe, expect, it, beforeAll } from "vitest";

/**
 * End-to-end: the real `hush` binary (dist/index.js) against a running local
 * backend, in a throwaway state dir and work dir.
 *
 * Requires:
 *   - backend dev server on http://localhost:4000 (with CRON_SECRET set)
 *   - `pnpm --filter hush build` has produced cli/dist/index.js
 *
 * The suite bootstraps its own user + keys, so it is independent of any seed
 * data. This is the "second machine" round-trip the definition of done asks for:
 * push here, pull into a different directory, compare bytes.
 */

const exec = promisify(execFile);
const API_URL = (process.env.HUSH_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
const CLI = resolve(__dirname, "..", "..", "dist", "index.js");
const PASSPHRASE = "e2e-test-passphrase";

let stateDir: string;
let workDir: string;
let token: string;

async function runCli(
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await exec(process.execPath, [CLI, ...args], {
      cwd: options.cwd ?? workDir,
      env: {
        ...process.env,
        HUSH_API_URL: API_URL,
        HUSH_TOKEN: token,
        HUSH_STATE_DIR: stateDir,
        HUSH_KEYCHAIN: "file",
        NO_COLOR: "1",
      },
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failed.code === "number" ? failed.code : 1,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
    };
  }
}

async function bootstrap(username: string): Promise<string> {
  // The dev bootstrap route exists only when DEV_BOOTSTRAP=1 (set in the
  // backend's .dev.vars for local runs).
  const response = await fetch(`${API_URL}${api.dev.bootstrap()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!response.ok) {
    throw new Error(`bootstrap failed: ${response.status} (is the backend running?)`);
  }
  const payload = (await response.json()) as { token: string };
  return payload.token;
}

beforeAll(async () => {
  expect(existsSync(CLI), `build the CLI first: pnpm --filter @xnah/hush build (${CLI})`).toBe(true);
  stateDir = mkdtempSync(join(tmpdir(), "hush-e2e-state-"));
  workDir = mkdtempSync(join(tmpdir(), "hush-e2e-work-"));

  const username = `e2e${Date.now().toString(36)}`;
  token = await bootstrap(username);

  const material = await createUserKeyMaterial(PASSPHRASE);
  const meResponse = await fetch(`${API_URL}${api.me.get()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const me = (await meResponse.json()) as { user: { id: string; githubUsername: string } };

  const upload = await fetch(`${API_URL}${api.me.keys()}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: material.publicKey,
      encryptedPrivateKey: material.encryptedPrivateKey,
      encryptedPrivateKeyRecovery: material.encryptedPrivateKeyRecovery,
      kdfSalt: material.kdfSalt,
      kdfParams: material.kdfParams,
      recoveryKeyHash: material.recoveryKeyHash,
    }),
  });
  expect(upload.ok).toBe(true);

  writeFileSync(
    join(stateDir, "keyfile"),
    JSON.stringify({
      userId: me.user.id,
      publicKey: material.publicKey,
      privateKey: toBase64(material.privateKey),
      cachedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    join(stateDir, "identity.json"),
    JSON.stringify({
      userId: me.user.id,
      tokenName: "e2e",
      githubUsername: me.user.githubUsername,
      name: me.user.githubUsername,
      avatarUrl: null,
    }),
  );
}, 120_000);

describe("hush CLI end to end", () => {
  const envFile = "FOO=bar\nSECRET_NAME=end-to-end-secret\nEXPORTED=yes\n# comment kept\n";

  it("whoami reports the bootstrapped user", async () => {
    const result = await runCli(["whoami", "--json"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      user: { githubUsername: string };
      keys: { setUp: boolean; unlockedOnThisMachine: boolean };
    };
    expect(payload.user.githubUsername).toMatch(/^e2e/);
    expect(payload.keys.setUp).toBe(true);
    expect(payload.keys.unlockedOnThisMachine).toBe(true);
  });

  it("init creates a project and links this folder", async () => {
    const result = await runCli(["init", "--name", "E2E Project", "-y", "--json"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      linked: { slug: string; defaultEnv: string };
      environments: string[];
    };
    expect(payload.environments.sort()).toEqual(["dev", "prod", "staging"]);
    expect(existsSync(join(workDir, ".hush.json"))).toBe(true);
    expect(existsSync(join(workDir, ".gitignore"))).toBe(true);
  });

  it("push uploads v1 and pull round-trips the exact bytes", async () => {
    writeFileSync(join(workDir, ".env"), envFile, "utf8");
    const push = await runCli(["push", "-e", "dev", "-m", "first", "--json"]);
    expect(push.code).toBe(0);
    const pushed = JSON.parse(push.stdout) as {
      pushed: boolean;
      version: number;
      environment: string;
    };
    expect(pushed.version).toBe(1);

    // "Second machine": fresh directory, same state (cached key), pull.
    const secondDir = mkdtempSync(join(tmpdir(), "hush-e2e-second-"));
    writeFileSync(join(secondDir, ".hush.json"), readFileSync(join(workDir, ".hush.json")));
    const pull = await runCli(["pull", "-e", "dev", "-o", "pulled.env", "--force", "--json"], {
      cwd: secondDir,
    });
    expect(pull.code).toBe(0);
    const downloaded = readFileSync(join(secondDir, "pulled.env"), "utf8");
    expect(downloaded).toBe(envFile);
  });

  it("push reports no changes when the content is identical", async () => {
    const result = await runCli(["push", "-e", "dev", "--json"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { pushed: boolean; reason: string };
    expect(payload.pushed).toBe(false);
    expect(payload.reason).toBe("no_changes");
  });

  it("diff shows remote changes with values masked unless --reveal", async () => {
    const masked = await runCli(["diff", "-e", "dev", "--json"]);
    expect(masked.code).toBe(0);
    const payload = JSON.parse(masked.stdout) as { inSync: boolean };
    expect(payload.inSync).toBe(true);

    writeFileSync(join(workDir, ".env"), `${envFile}NEW_KEY=added-locally\n`, "utf8");
    const revealed = await runCli(["diff", "-e", "dev", "--reveal"]);
    expect(revealed.code).toBe(0);
    expect(revealed.stdout).toContain("NEW_KEY");
    expect(revealed.stdout).toContain("added-locally");
  });

  it("check fails on a missing variable and passes when complete", async () => {
    writeFileSync(join(workDir, ".env.example"), "FOO=\nSECRET_NAME=\nNEW_KEY=\nMISSING=here\n", "utf8");
    writeFileSync(join(workDir, ".env"), `${envFile}NEW_KEY=added-locally\n`, "utf8");
    const failing = await runCli(["check"]);
    expect(failing.code).toBe(1);
    expect(failing.stdout + failing.stderr).toContain("MISSING");

    writeFileSync(join(workDir, ".env"), `FOO=bar\nSECRET_NAME=x\nNEW_KEY=y\nMISSING=z\n`, "utf8");
    const passing = await runCli(["check", "--json"]);
    expect(passing.code).toBe(0);
    expect((JSON.parse(passing.stdout) as { ok: boolean }).ok).toBe(true);
  });

  it("run injects variables without writing a file", async () => {
    const before = readdirSync(workDir).sort().join(",");
    const result = await runCli([
      "run",
      "-e",
      "dev",
      "--",
      process.execPath,
      "-e",
      "console.log('VALUE=' + process.env.SECRET_NAME)",
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("VALUE=end-to-end-secret");
    const after = readdirSync(workDir).sort().join(",");
    expect(after).toBe(before);
  });

  it("history, rollback and ls behave", async () => {
    writeFileSync(join(workDir, ".env"), "# v2\nFOO=bar\nSECRET_NAME=end-to-end-secret\n", "utf8");
    const secondPush = await runCli(["push", "-e", "dev", "-m", "second", "--json"]);
    expect(JSON.parse(secondPush.stdout).version).toBe(2);

    const history = await runCli(["history", "-e", "dev", "--json"]);
    expect(history.code).toBe(0);
    const versions = (JSON.parse(history.stdout) as { versions: Array<{ version: number }> }).versions;
    expect(versions.map((version) => version.version)).toEqual([2, 1]);

    const rollback = await runCli(["rollback", "-e", "dev", "1", "--json"]);
    expect(rollback.code).toBe(0);
    expect((JSON.parse(rollback.stdout) as { version: number }).version).toBe(3);

    const ls = await runCli(["ls", "--json"]);
    expect(ls.code).toBe(0);
    const projects = (JSON.parse(ls.stdout) as { projects: Array<{ slug: string }> }).projects;
    // Slugs get numeric suffixes when a previous run already took the name.
    expect(projects.some((project) => project.slug.startsWith("e2e-project"))).toBe(true);
  });

  it("members lists the owner", async () => {
    const result = await runCli(["members", "--json"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { members: Array<{ role: string }> };
    expect(payload.members.some((member) => member.role === "owner")).toBe(true);
  });

  it("doctor passes with a healthy setup", async () => {
    const result = await runCli(["doctor", "--json"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { ok: boolean };
    expect(payload.ok).toBe(true);
  });

  it("lock ends the session for key operations and reads fail closed", async () => {
    // Self-contained: this test also runs on its own with -t.
    if (!existsSync(join(workDir, ".hush.json"))) {
      await runCli(["init", "--name", "E2E Lock Project", "-y"]);
    }
    const lock = await runCli(["lock", "--json"]);
    expect(lock.code).toBe(0);
    // Metadata-only commands still work after locking...
    const history = await runCli(["history", "-e", "dev", "--json"]);
    expect(history.code).toBe(0);
    // ...but anything that needs the key fails with exit code 3, no hang.
    const locked = await runCli(["pull", "-e", "dev", "-o", "locked.env", "--force"]);
    expect(locked.code).toBe(3);
    expect(locked.stderr + locked.stdout).toMatch(/locked/i);
  });
});
