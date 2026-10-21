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
 * destination directory, then renamed over the target; a symlink at the target
 * is replaced rather than followed.
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
    closeSync(fd);
    unlinkSync(tmp);
    throw error;
  }
  closeSync(fd);
  chmodSync(tmp, mode);
  renameSync(tmp, path);
  try {
    chmodSync(path, mode);
  } catch {
    // Windows ACLs do not map to POSIX modes; best effort only.
  }
}
