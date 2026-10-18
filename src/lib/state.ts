import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PRODUCT } from "@hush/schemas";

/**
 * Local state: where the token, the key cache and the project link live.
 *
 * HUSH_STATE_DIR and HUSH_API_URL exist for tests and advanced setups
 * (CI machines, multiple profiles) — the defaults are what users get.
 *
 * The product used to be called envhx; installs from before the rename keep
 * working. Two deliberate legacy paths survive here:
 *   - ~/.config/envhx is moved to ~/.config/hush on first use (token + keys
 *     come along, so nobody gets locked out), and
 *   - repositories still linked through .envhx.json are read; the next write
 *     upgrades them to .hush.json.
 */

const LEGACY_DIR = ".config/envhx";
const LEGACY_PROJECT_LINK_FILE = ".envhx.json";

let stateDirResolved = false;

function migrateLegacyStateDir(): void {
  if (stateDirResolved) {
    return;
  }
  stateDirResolved = true;
  // A custom state dir (tests, profiles) has nothing to migrate.
  if (process.env.HUSH_STATE_DIR?.trim()) {
    return;
  }
  const legacy = join(homedir(), ...LEGACY_DIR.split("/"));
  try {
    if (!existsSync(legacy)) {
      return;
    }
    const target = join(homedir(), ".config", "hush");
    mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const entry of readdirSync(legacy)) {
      const from = join(legacy, entry);
      const to = join(target, entry);
      if (existsSync(to)) {
        continue; // never overwrite state written by the new version
      }
      try {
        renameSync(from, to);
      } catch {
        try {
          copyFileSync(from, to);
          rmSync(from, { force: true });
        } catch {
          // Best effort: a locked file just stays behind.
        }
      }
    }
    if (readdirSync(legacy).length === 0) {
      rmSync(legacy, { recursive: true, force: true });
    }
  } catch {
    // Migration is best-effort; the CLI still works from scratch.
  }
}

export function stateDir(): string {
  migrateLegacyStateDir();
  const override = process.env.HUSH_STATE_DIR?.trim();
  if (override) {
    return override;
  }
  return join(homedir(), ".config", "hush");
}

export function ensureStateDir(): string {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function statePath(name: string): string {
  return join(stateDir(), name);
}

export function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Writes atomically, with 0600 permissions where the platform supports them. */
export function writeJsonFile(path: string, value: unknown, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  renameSync(tmp, path);
}

export function removeFile(path: string): void {
  rmSync(path, { force: true });
}

export function apiUrl(override?: string): string {
  const value =
    override?.trim() || process.env.HUSH_API_URL?.trim() || PRODUCT.apiUrl;
  return value.replace(/\/+$/, "");
}

export interface ProjectLink {
  projectId: string;
  projectSlug: string;
  defaultEnv: string;
}

export const PROJECT_LINK_FILE = ".hush.json";

export function readProjectLink(cwd = process.cwd()): ProjectLink | null {
  const current = readJsonFile<ProjectLink>(join(cwd, PROJECT_LINK_FILE));
  if (current) {
    return current;
  }
  // Pre-rename repositories keep working; a later write upgrades the file.
  return readJsonFile<ProjectLink>(join(cwd, LEGACY_PROJECT_LINK_FILE));
}

export function writeProjectLink(link: ProjectLink, cwd = process.cwd()): string {
  const path = join(cwd, PROJECT_LINK_FILE);
  writeJsonFile(path, link, 0o644);
  return path;
}

export interface Identity {
  userId: string;
  tokenName: string;
  githubUsername: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export function readIdentity(): Identity | null {
  return readJsonFile<Identity>(statePath("identity.json"));
}

export function writeIdentity(identity: Identity): void {
  writeJsonFile(statePath("identity.json"), identity);
}
