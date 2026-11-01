/**
 * Child-process environment policy for `hush run`.
 *
 * A remote env is data, not authority over the local process. Variables that
 * change executable resolution, loaders, interpreters, proxies or credential
 * stores never reach the child, and the CLI's own HUSH_* namespace is reserved
 * on both the inherited and the remote side of the merge.
 */

export const EXECUTION_ENV = new Set([
  "PATH",
  "PATHEXT",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "NODE_EXTRA_CA_CERTS",
  "LD_PRELOAD",
  "LD_AUDIT",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "BASH_ENV",
  "ENV",
  "PYTHONSTARTUP",
  "PYTHONPATH",
  "PYTHONHOME",
  "PERL5OPT",
  "RUBYOPT",
  "JAVA_TOOL_OPTIONS",
  "GCONV_PATH",
  "GIT_SSH_COMMAND",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "SHELLOPTS",
  "PS4",
  "PROMPT_COMMAND",
  "IFS",
  "CDPATH",
  "HOME",
  "SSLKEYLOGFILE",
  "OPENSSL_CONF",
  "KUBECONFIG",
  "AWS_SHARED_CREDENTIALS_FILE",
  "ELECTRON_RUN_AS_NODE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
]);

/** Prefixes rather than a fragile exhaustive list. */
export const EXECUTION_PREFIXES = ["LD_", "DYLD_", "BASH_FUNC_", "HUSH_", "NPM_CONFIG_"];

export function isBlockedRemoteEnv(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    upper.startsWith("HUSH_") ||
    EXECUTION_ENV.has(upper) ||
    EXECUTION_PREFIXES.some((prefix) => upper.startsWith(prefix))
  );
}

export interface ChildEnvOptions {
  parent: NodeJS.ProcessEnv;
  remote: Map<string, string>;
  only: ReadonlySet<string>;
  except: ReadonlySet<string>;
  noInherit: boolean;
}

export interface ChildEnvResult {
  env: Record<string, string>;
  blocked: string[];
  injected: number;
}

export function buildChildEnv(options: ChildEnvOptions): ChildEnvResult {
  const env: Record<string, string> = {};
  if (!options.noInherit) {
    for (const [key, value] of Object.entries(options.parent)) {
      if (value !== undefined && !key.startsWith("HUSH_")) {
        env[key] = value;
      }
    }
  }

  const blocked: string[] = [];
  let injected = 0;
  for (const [key, value] of options.remote) {
    if (options.only.size > 0 && !options.only.has(key)) {
      continue;
    }
    if (options.except.has(key)) {
      continue;
    }
    if (isBlockedRemoteEnv(key)) {
      blocked.push(key);
      continue;
    }
    env[key] = value;
    injected += 1;
  }

  return { env, blocked, injected };
}
