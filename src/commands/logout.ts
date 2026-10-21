import { api, type MeTokensResponse, type OkResponse } from "@hush/schemas";
import { defineCommand } from "citty";
import { globalArgs, requireClient, runWithArgs } from "../lib/command";
import { CliError } from "../lib/errors";
import { clearPrivateKeyCache, clearToken } from "../lib/session";
import { readIdentity, removeFile, statePath } from "../lib/state";
import { info, success, warn } from "../lib/ui";

export const logoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "Revoke this device's token and clear cached keys",
  },
  args: {
    ...globalArgs,
    local: {
      type: "boolean",
      description: "Clear local state without revoking the server token",
      default: false,
    },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      if (args.local) {
        warn("Clearing local state only; the server token stays valid.");
      } else {
        const identity = readIdentity();
        const client = await requireClient(args);
        const { tokens } = await client.get<MeTokensResponse>(api.me.tokens());
        const matching = identity
          ? tokens.find((token) => token.name === identity.tokenName && !token.revokedAt)
          : undefined;
        if (!matching) {
          throw CliError.auth(
            "Could not identify this device's token.",
            "Revoke it in the dashboard, or use `hush logout --local` to clear this machine only.",
          );
        }
        await client.del<OkResponse>(api.me.token(matching.id));
        info(`Revoked token "${matching.name}" on the server.`);
      }
      await clearToken();
      await clearPrivateKeyCache();
      removeFile(statePath("identity.json"));
      success("Logged out. Cached keys cleared.");
    });
  },
});
