import { api, type MeKeysResponse, type MeResponse } from "@hush/schemas";
import { defineCommand } from "citty";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import { keychainStatus } from "../lib/keychain";
import { loadCachedPrivateKey } from "../lib/session";
import { readIdentity, readProjectLink } from "../lib/state";
import { isJsonMode, out, printJson, table } from "../lib/ui";

export const whoamiCommand = defineCommand({
  meta: { name: "whoami", description: "Show the signed-in user, device and key status" },
  args: { ...globalArgs },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const client = await requireClient(args);
      const [me, keys, keychain, cached] = await Promise.all([
        client.get<MeResponse>(api.me.get()),
        client.get<MeKeysResponse>(api.me.keys()),
        keychainStatus(),
        loadCachedPrivateKey(),
      ]);
      const identity = readIdentity();
      const link = readProjectLink();

      const payload = {
        user: {
          id: me.user.id,
          githubUsername: me.user.githubUsername,
          name: me.user.name,
          email: me.user.email,
        },
        device: identity?.tokenName ?? "unknown",
        keys: {
          setUp: Boolean(keys.keys),
          publicKey: keys.keys?.publicKey ?? null,
          kdf: keys.keys?.kdfParams ?? null,
          unlockedOnThisMachine: Boolean(cached),
        },
        keychain: { available: keychain.available, backend: keychain.backend },
        project: link,
      };

      if (isJsonMode()) {
        printJson(payload);
        return;
      }

      out(
        table([
          ["user", `@${me.user.githubUsername ?? me.user.id} (${me.user.name ?? "no name"})`],
          ["email", me.user.email ?? "-"],
          ["device", payload.device],
          [
            "keychain",
            keychain.available ? "OS keychain (available)" : "file fallback (~/.config/hush, 0600)",
          ],
          [
            "keys",
            keys.keys
              ? `${cached ? "unlocked on this machine" : "locked"} (${keys.keys.kdfParams.algorithm}, public key ${keys.keys.publicKey.slice(0, 8)}…)`
              : "not set up yet, run `hush login`",
          ],
          ["project", link ? `${link.projectSlug} (default env: ${link.defaultEnv})` : "not linked here"],
        ]),
      );
    });
  },
});
