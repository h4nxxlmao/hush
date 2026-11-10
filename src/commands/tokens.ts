import { confirm, isCancel } from "@clack/prompts";
import { api, type MeTokensResponse, type OkResponse } from "@hush/schemas";
import { defineCommand } from "citty";
import {
  globalArgs,
  isInteractive,
  requireClient,
  runWithArgs,
} from "../lib/command";
import { info, isJsonMode, out, printJson, relativeTime, success, table, dim, bold } from "../lib/ui";
import { CliError } from "../lib/errors";

/** `hush tokens`, list this account's CLI tokens or revoke one by id. */
export const tokensCommand = defineCommand({
  meta: { name: "tokens", description: "List or revoke CLI device tokens" },
  args: {
    ...globalArgs,
    revoke: {
      type: "positional",
      description: "Token id to revoke (see `hush tokens`)",
      required: false,
    },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const client = await requireClient(args);
      const response = await client.get<MeTokensResponse>(api.me.tokens());

      if (args.revoke) {
        const id = String(args.revoke).trim();
        const token = response.tokens.find((entry) => entry.id === id);
        if (!token) {
          throw CliError.usage(
            `No token with id "${id}".`,
            "Run `hush tokens` to list them.",
          );
        }
        if (!args.yes && isInteractive()) {
          const ok = await confirm({
            message: `Revoke the CLI token "${token.name}"? That device will need to sign in again.`,
            initialValue: false,
          });
          if (isCancel(ok) || !ok) {
            info("Nothing changed.");
            return;
          }
        }
        await client.del<OkResponse>(api.me.token(id));
        if (isJsonMode()) {
          printJson({ revoked: true, id, name: token.name });
          return;
        }
        success(`Revoked ${token.name}.`);
        return;
      }

      if (isJsonMode()) {
        printJson({ tokens: response.tokens });
        return;
      }
      if (response.tokens.length === 0) {
        info("No CLI tokens on this account. Run `hush login` on a machine to create one.");
        return;
      }
      const rows: string[][] = [["ID", "NAME", "CREATED", "LAST USED", "STATUS"].map((h) => dim(h))];
      for (const token of response.tokens) {
        rows.push([
          token.id,
          token.name,
          relativeTime(new Date(token.createdAt)),
          token.lastUsedAt ? relativeTime(new Date(token.lastUsedAt)) : "never",
          token.revokedAt ? "revoked" : "active",
        ]);
      }
      out(bold(table(rows)));
      info("Revoke one with `hush tokens <id>`.");
    });
  },
});
