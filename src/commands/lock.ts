import { defineCommand } from "citty";
import { globalArgs, runWithArgs } from "../lib/command";
import { clearPrivateKeyCache, loadCachedPrivateKey } from "../lib/session";
import { info, isJsonMode, printJson, success } from "../lib/ui";

export const lockCommand = defineCommand({
  meta: { name: "lock", description: "Forget the cached private key on this machine" },
  args: { ...globalArgs },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const cached = await loadCachedPrivateKey();
      await clearPrivateKeyCache();
      if (isJsonMode()) {
        printJson({ locked: true, hadCachedKey: Boolean(cached) });
        return;
      }
      success("Locked. The private key was removed from the keychain and disk cache.");
      info("Commands needing the key will ask for your passphrase again.");
    });
  },
});
