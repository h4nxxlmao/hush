import { api, type MeTokensResponse, type OkResponse } from "@hush/schemas";
import { defineCommand } from "citty";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import { clearPrivateKeyCache, clearToken } from "../lib/session";
import { readIdentity, removeFile, statePath } from "../lib/state";
import { info, success } from "../lib/ui";

export const logoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "Revoke this device's token and clear cached keys",
  },
  args: { ...globalArgs },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const identity = readIdentity();
      try {
        const client = await requireClient(args);
        const { tokens } = await client.get<MeTokensResponse>(api.me.tokens());
        const matching = identity
          ? tokens.find((token) => token.name === identity.tokenName && !token.revokedAt)
          : tokens.find((token) => !token.revokedAt);
        if (matching) {
          await client.del<OkResponse>(api.me.token(matching.id));
          info(`Revoked token "${matching.name}" on the server.`);
        }
      } catch {
        info("Could not reach the server; clearing local state only.");
      }
      await clearToken();
      await clearPrivateKeyCache();
      removeFile(statePath("identity.json"));
      success("Logged out. Cached keys cleared.");
    });
  },
});
