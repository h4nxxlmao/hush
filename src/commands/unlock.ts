import { defineCommand } from "citty";
import { globalArgs, requireClient, requireInteractive, runWithArgs } from "../lib/command";
import { askPassphrase, requirePrivateKey } from "../lib/session";
import { isJsonMode, printJson, success } from "../lib/ui";

export const unlockCommand = defineCommand({
  meta: {
    name: "unlock",
    description: "Unlock your private key with your passphrase (or a recovery key)",
  },
  args: {
    ...globalArgs,
    recovery: {
      type: "boolean",
      description: "Ask for the recovery key instead of the passphrase",
      default: false,
    },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const client = await requireClient(args);
      requireInteractive("unlock interactively");
      let recoveryKey: string | undefined;
      if (args.recovery) {
        recoveryKey = await askPassphrase("Recovery key (XXXX-XXXX-…)");
      }
      const handle = await requirePrivateKey(
        client,
        recoveryKey ? { recoveryKey } : { prompt: true },
      );
      if (isJsonMode()) {
        printJson({ unlocked: true, publicKey: handle.publicKey });
        return;
      }
      success("Key unlocked and cached for this machine.");
    });
  },
});
