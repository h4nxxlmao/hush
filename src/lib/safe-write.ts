import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Write a secret-bearing file without following links and without exposing a
 * partially written file. The temporary file is created exclusively in the
 * destination directory, then renamed over the target; a symlink or any other
 * non-regular target is refused.
 */
export function writeFileNoFollow(path: string, content: string, mode = 0o600): void {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) {
      throw new Error(`Refusing to write ${path}: not a regular file.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const tmp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const fd = openSync(tmp, "wx", mode);
  try {
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      // The original error is the useful one.
    }
    try {
      unlinkSync(tmp);
    } catch {
      // Best effort: a failed cleanup must not mask the write error.
    }
    throw error;
  }
  try {
    closeSync(fd);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // Best effort.
    }
    throw error;
  }
  try {
    chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // Best effort: never leave the secret-bearing temp behind if possible.
    }
    throw error;
  }
  try {
    chmodSync(path, mode);
  } catch {
    // Windows ACLs do not map to POSIX modes; best effort only.
  }
}
