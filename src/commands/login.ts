import { hostname } from "node:os";
import { confirm, isCancel, note, password as promptPassword } from "@clack/prompts";
import { api, type DeviceCodeResponse, type DeviceTokenResponse, type MeResponse } from "@hush/schemas";
import { defineCommand } from "citty";
import open from "open";
import { HushApiError } from "../lib/api";
import { globalArgs, requireInteractive, runWithArgs, sleep, unauthenticatedClient } from "../lib/command";
import { CliError } from "../lib/errors";
import { requirePrivateKey, saveToken, setupUserKeys } from "../lib/session";
import { writeIdentity } from "../lib/state";
import { bold, createSpinner, info, isJsonMode, out, printJson, success, warn } from "../lib/ui";

/**
 * `hush login` — RFC 8628 device flow, then key setup on first login.
 *
 * 1. ask for a device code, open the browser at /device with the code
 * 2. poll until the user approves (slow_down respected)
 * 3. store the CLI token + identity
 * 4a. first login: choose a passphrase, generate the X25519 keypair, upload the
 *     sealed private key, show the recovery key exactly once and confirm it
 * 4b. later logins: offer to unlock (cache the private key in the keychain)
 */

async function choosePassphrase(): Promise<string> {
  const first = await promptPassword({
    message: "Choose a passphrase (min 8 characters). It never leaves this machine.",
    validate: (value) => (value && value.length >= 8 ? undefined : "At least 8 characters."),
  });
  if (isCancel(first)) {
    throw new CliError("Cancelled. Nothing was changed.");
  }
  const second = await promptPassword({ message: "Repeat the passphrase" });
  if (isCancel(second)) {
    throw new CliError("Cancelled. Nothing was changed.");
  }
  if (first !== second) {
    throw CliError.usage("Passphrases didn't match. Nothing was changed.", "Run `hush login` again.");
  }
  return String(first);
}

export const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Sign in (device flow) and set up your encryption keys",
  },
  args: {
    ...globalArgs,
    device: {
      type: "string",
      description: "Device name shown on the approval page (defaults to this hostname)",
    },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const client = unauthenticatedClient(args);
      const deviceName = (args.device as string | undefined)?.trim() || hostname() || "CLI device";

      const code = await client.post<DeviceCodeResponse>(api.cliDevice.code(), { deviceName });

      if (!isJsonMode()) {
        out();
        out(`  ${bold("Open the browser and approve this device")}`);
        out(`  ${code.verificationUriComplete}`);
        out();
        out(`  ${bold("Code:")} ${code.userCode}`);
        out();
      } else {
        printJson({ userCode: code.userCode, verificationUriComplete: code.verificationUriComplete });
      }

      try {
        await open(code.verificationUriComplete);
        if (!isJsonMode()) {
          info("Opened your browser. Approve the request there.");
        }
      } catch {
        if (!isJsonMode()) {
          info(`Open ${code.verificationUri} and enter the code above.`);
        }
      }

      const spin = createSpinner("Waiting for approval…");
      let interval = code.interval;
      const deadline = Date.now() + code.expiresIn * 1000;
      let tokenResponse: DeviceTokenResponse | null = null;

      while (!tokenResponse) {
        if (Date.now() > deadline) {
          spin.fail("Timed out");
          throw new CliError("The device code expired.", 1, "Run `hush login` again.");
        }
        await sleep(interval * 1000);
        try {
          tokenResponse = await client.post<DeviceTokenResponse>(api.cliDevice.token(), {
            deviceCode: code.deviceCode,
          });
        } catch (error) {
          if (error instanceof HushApiError) {
            if (error.code === "authorization_pending") {
              continue;
            }
            if (error.code === "slow_down") {
              const details = error.details as { interval?: number } | undefined;
              interval = details?.interval ?? Math.min(interval + 5, 60);
              spin.update(`Waiting for approval… (polling every ${interval}s)`);
              continue;
            }
            if (error.code === "access_denied") {
              spin.fail("Denied");
              throw new CliError("The request was denied in the browser.", 1);
            }
            if (error.code === "expired_token") {
              spin.fail("Expired");
              throw new CliError("The device code expired.", 1, "Run `hush login` again.");
            }
          }
          spin.fail("Failed");
          throw error;
        }
      }

      spin.stop(`Approved as ${tokenResponse.user.githubUsername ?? tokenResponse.user.name ?? "you"}`);
      await saveToken(tokenResponse.accessToken);

      const authorized = { ...client, token: tokenResponse.accessToken };
      const me = await authorized.get<MeResponse>(api.me.get());
      writeIdentity({
        userId: me.user.id,
        tokenName: tokenResponse.tokenName,
        githubUsername: me.user.githubUsername,
        name: me.user.name,
        avatarUrl: me.user.avatarUrl,
      });
      success(`Signed in as @${me.user.githubUsername ?? me.user.id} (device: ${tokenResponse.tokenName}).`);

      if (tokenResponse.hasKeys) {
        if (isJsonMode()) {
          printJson({ signedIn: true, hasKeys: true, userCode: code.userCode, tokenName: tokenResponse.tokenName });
          return;
        }
        const unlockNow = await confirm({
          message: "Keys already exist. Unlock now and cache the key on this machine?",
          initialValue: true,
        });
        if (!isCancel(unlockNow) && unlockNow) {
          await requirePrivateKey(authorized, { prompt: true });
          success("Key unlocked and cached. `hush lock` clears it again.");
        } else {
          info("Locked. Commands that need the key will ask for your passphrase.");
        }
        return;
      }

      // First login: create the keypair and both sealed copies.
      if (!isJsonMode()) {
        out();
        info("Setting up encryption. Your keys are generated here, never on the server.");
        info("Pick a passphrase nobody can guess — it protects your private key on every device.");
        out();
      }
      requireInteractive("set up a passphrase");
      const passphrase = await choosePassphrase();
      const material = await setupUserKeys(authorized, { passphrase, userId: me.user.id });

      if (isJsonMode()) {
        printJson({
          signedIn: true,
          hasKeys: true,
          publicKey: material.publicKey,
          recoveryKey: material.recoveryKey,
          userCode: code.userCode,
          tokenName: tokenResponse.tokenName,
        });
        return;
      }

      out();
      note(material.recoveryKey, "Recovery key — shown once. Save it now (password manager).");
      warn("If you lose both the passphrase and this recovery key, your data is unrecoverable. By design.");
      if (args.yes) {
        success("Keys set up. You are ready to `hush init`.");
        return;
      }
      const saved = await confirm({
        message: "I saved my recovery key somewhere safe",
        initialValue: false,
      });
      if (isCancel(saved) || !saved) {
        warn("Without the recovery key, a forgotten passphrase means permanent data loss.");
      }
      success(`Keys set up for @${me.user.githubUsername}. Start with \`hush init\`.`);
    });
  },
});
