import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { CliError } from "./errors";

/**
 * A committed `.env` symlink must not turn a local command into a reader for
 * an arbitrary file outside the repository. Symlinks inside the working tree
 * stay allowed for direnv-style setups; anything resolving outside it is
 * refused before the file is read.
 */
export function assertEnvFileInsideCwd(path: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return;
  }
  if (!stat.isSymbolicLink()) {
    return;
  }
  let real: string;
  let cwd: string;
  try {
    real = realpathSync(path);
    cwd = realpathSync(process.cwd());
  } catch {
    throw CliError.usage(
      `Cannot resolve the symlink at ${path}.`,
      "Pass the real file path instead.",
    );
  }
  const rel = relative(cwd, real);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw CliError.usage(
      `Refusing to read ${path}: it points outside this folder.`,
      `Resolved to ${real}. Pass the real file path explicitly if that is intended.`,
    );
  }
}
