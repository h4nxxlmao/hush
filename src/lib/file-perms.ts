import { statSync } from "node:fs";
import { basename } from "node:path";
import { warn } from "./ui";

/**
 * POSIX file-permission checks for .env files. On Windows the ACL model doesn't
 * map to POSIX modes, so the check is skipped there (reported as "n/a").
 */

export interface FilePermissionStatus {
  path: string;
  mode: string | null;
  worldReadable: boolean;
  supported: boolean;
}

export function checkFilePermissions(path: string): FilePermissionStatus {
  if (process.platform === "win32") {
    return { path, mode: null, worldReadable: false, supported: false };
  }
  try {
    const mode = statSync(path).mode & 0o777;
    return {
      path,
      mode: mode.toString(8),
      worldReadable: (mode & 0o077) !== 0,
      supported: true,
    };
  } catch {
    return { path, mode: null, worldReadable: false, supported: false };
  }
}

export function warnIfWorldReadable(path: string): void {
  const status = checkFilePermissions(path);
  if (status.supported && status.worldReadable) {
    warn(
      `${basename(path)} is readable by other users (mode ${status.mode}). Consider: chmod 600 ${basename(path)}`,
    );
  }
}
