import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { api, type HealthResponse, type MeKeysResponse, type MeResponse } from "@hush/schemas";
import { defineCommand } from "citty";
import { createApiClient } from "../lib/api";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import { checkFilePermissions } from "../lib/file-perms";
import { checkGitignore } from "../lib/gitignore";
import { keychainStatus } from "../lib/keychain";
import { loadCachedPrivateKey, loadToken } from "../lib/session";
import { apiUrl, readProjectLink, stateDir } from "../lib/state";
import {
  bold,
  dim,
  green,
  info,
  isJsonMode,
  out,
  printJson,
  red,
  table,
  yellow,
} from "../lib/ui";

/**
 * `hush doctor` — the support triage that users can run themselves.
 * Checks API reachability, token validity, keychain, key setup, .gitignore
 * coverage, file permissions, and the linked project.
 */

export const doctorCommand = defineCommand({
  meta: { name: "doctor", description: "Diagnose connectivity, auth, keys and local hygiene" },
  args: { ...globalArgs },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const results: Array<{ check: string; ok: boolean; detail: string; warnOnly?: boolean }> = [];
      const base = apiUrl(args["api-url"]);
      const anonymous = createApiClient({ baseUrl: base });

      // 1. API reachability
      try {
        const health = await anonymous.get<HealthResponse>(api.health());
        results.push({ check: "api", ok: true, detail: `${base} (v${health.version})` });
      } catch (error) {
        results.push({
          check: "api",
          ok: false,
          detail: `unreachable: ${error instanceof Error ? error.message : "unknown"}`,
        });
      }

      // 2. Token validity
      const token = await loadToken();
      let client: Awaited<ReturnType<typeof requireClient>> | null = null;
      if (!token) {
        results.push({ check: "token", ok: false, detail: "no token — run `hush login`" });
      } else {
        try {
          const me = await anonymousWithToken(base, token);
          results.push({
            check: "token",
            ok: true,
            detail: `valid for @${me.user.githubUsername ?? me.user.id}`,
          });
          client = createApiClient({ baseUrl: base, token });
        } catch (error) {
          results.push({
            check: "token",
            ok: false,
            detail: `rejected: ${error instanceof Error ? error.message : "unknown"}`,
          });
        }
      }

      // 3. Keychain
      const keychain = await keychainStatus();
      const cached = await loadCachedPrivateKey();
      results.push({
        check: "keychain",
        ok: true,
        warnOnly: !keychain.available,
        detail: keychain.available
          ? `OS keychain available${cached ? " · key cached" : " · no cached key"}`
          : `file fallback in ~/.config/hush (0600)${cached ? " · key cached" : " · locked"}`,
      });

      // 4. Keys set up
      if (client) {
        try {
          const { keys } = await client.get<MeKeysResponse>(api.me.keys());
          results.push({
            check: "keys",
            ok: Boolean(keys),
            detail: keys
              ? `${keys.kdfParams.algorithm} · public key ${keys.publicKey.slice(0, 10)}…`
              : "not set up — run `hush login`",
          });
        } catch (error) {
          results.push({
            check: "keys",
            ok: false,
            detail: `could not read: ${error instanceof Error ? error.message : "unknown"}`,
          });
        }
      }

      // 5. .gitignore coverage
      const gitignore = checkGitignore(process.cwd());
      results.push({
        check: ".gitignore",
        ok: gitignore.covered,
        warnOnly: true,
        detail: gitignore.covered
          ? "covers .env files"
          : `missing: ${gitignore.missing.join(", ")} — run \`hush init\``,
      });

      // 6. .env permissions
      const envPath = resolve(process.cwd(), ".env");
      if (existsSync(envPath)) {
        const perms = checkFilePermissions(envPath);
        results.push({
          check: ".env perms",
          ok: !perms.worldReadable,
          warnOnly: true,
          detail: perms.supported
            ? `mode ${perms.mode}${perms.worldReadable ? " (readable by others — chmod 600 .env)" : ""}`
            : "n/a on Windows",
        });
      } else {
        results.push({ check: ".env perms", ok: true, warnOnly: true, detail: "no .env here yet" });
      }

      // 7. Linked project
      const link = readProjectLink();
      if (!link) {
        results.push({
          check: "project",
          ok: true,
          warnOnly: true,
          detail: "not linked in this folder (run `hush init`)",
        });
      } else if (client) {
        try {
          await client.get(api.projects.get(link.projectSlug));
          results.push({
            check: "project",
            ok: true,
            detail: `${link.projectSlug} reachable (default env: ${link.defaultEnv})`,
          });
        } catch (error) {
          results.push({
            check: "project",
            ok: false,
            detail: `${link.projectSlug}: ${error instanceof Error ? error.message : "unknown"}`,
          });
        }
      }

      const failures = results.filter((result) => !result.ok && !result.warnOnly);
      if (isJsonMode()) {
        printJson({ ok: failures.length === 0, checks: results });
      } else {
        out(bold("hush doctor"));
        out(
          table(
            results.map((result) => [
              result.ok ? green("✔") : result.warnOnly ? yellow("!") : red("✖"),
              result.check,
              dim(result.detail),
            ]),
          ),
        );
        out();
        if (failures.length === 0) {
          console.log(green("Everything that must work, works."));
        } else {
          console.log(red(`${failures.length} check${failures.length === 1 ? "" : "s"} failing.`));
        }
        info(`State directory: ${stateDir()}`);
      }
      if (failures.length > 0) {
        process.exitCode = 1;
      }
    });
  },
});

async function anonymousWithToken(baseUrl: string, token: string): Promise<MeResponse> {
  const client = createApiClient({ baseUrl, token });
  return client.get<MeResponse>(api.me.get());
}
