import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { defineCommand } from "citty";
import { globalArgs, runWithArgs } from "../lib/command";
import { exampleFromEnvContent, parseEnvContent } from "../lib/dotenv-file";
import { assertEnvFileInsideCwd } from "../lib/env-path";
import { CliError } from "../lib/errors";
import { writeFileNoFollow } from "../lib/safe-write";
import { info, isJsonMode, printJson, success } from "../lib/ui";

/**
 * `hush example`, turn a real .env into a safe .env.example with every value
 * blanked. Keys stay in file order; comments are intentionally dropped so a
 * stray secret in a comment cannot be committed.
 */
export const exampleCommand = defineCommand({
  meta: { name: "example", description: "Generate .env.example from a .env (values blanked)" },
  args: {
    ...globalArgs,
    file: {
      type: "positional",
      description: "Source env file",
      required: false,
      default: ".env",
    },
    out: { type: "string", alias: "o", description: "Output file", default: ".env.example" },
    force: {
      type: "boolean",
      description: "Overwrite an existing example file",
      default: false,
    },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const source = resolve(process.cwd(), String(args.file ?? ".env"));
      const out = resolve(process.cwd(), String(args.out ?? ".env.example"));
      if (!existsSync(source)) {
        throw CliError.usage(`${args.file ?? ".env"} not found in this folder.`);
      }
      assertEnvFileInsideCwd(source);
      try {
        if (realpathSync(source) === realpathSync(out)) {
          throw CliError.usage("The example output cannot be the source .env itself.");
        }
      } catch (error) {
        if (error instanceof CliError) {
          throw error;
        }
        // The output does not exist yet; the resolved-path check is enough.
        if (source === out) {
          throw CliError.usage("The example output cannot be the source .env itself.");
        }
      }
      if (existsSync(out) && !args.force) {
        throw CliError.usage(
          `${args.out ?? ".env.example"} already exists.`,
          "Pass --force to overwrite it.",
        );
      }
      const content = readFileSync(source, "utf8");
      const example = exampleFromEnvContent(content);
      if (!example) {
        throw CliError.usage(`${args.file ?? ".env"} has no variables.`);
      }
      const keys = parseEnvContent(content).entries.length;
      let mode = 0o644;
      try {
        const stat = lstatSync(out);
        if (stat.isFile()) {
          mode = stat.mode & 0o777;
        }
      } catch {
        // A new file gets the example default.
      }
      writeFileNoFollow(out, example, mode);
      if (isJsonMode()) {
        printJson({ written: true, file: out, keys });
        return;
      }
      success(`Wrote ${args.out ?? ".env.example"} with ${keys} keys and no values.`);
      info("Check the file before committing; keys alone can still be sensitive.");
    });
  },
});
