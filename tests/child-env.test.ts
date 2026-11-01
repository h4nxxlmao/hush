import { describe, expect, it } from "vitest";
import { buildChildEnv, isBlockedRemoteEnv } from "../src/lib/child-env";

describe("buildChildEnv", () => {
  const remote = new Map([
    ["SAFE", "remote"],
    ["NORMAL", "ok"],
    ["HUSH_STATE_DIR", "tmp/h"],
    ["HUSH_TOKEN", "stolen"],
    ["NODE_OPTIONS", "--require ./evil.js"],
    ["HTTPS_PROXY", "http://127.0.0.1:9"],
  ]);

  it("strips the CLI namespace from inherited and remote environments", () => {
    const result = buildChildEnv({
      parent: { PATH: "/usr/bin", HUSH_TOKEN: "parent-token", SAFE: "parent" },
      remote,
      only: new Set(),
      except: new Set(),
      noInherit: false,
    });
    expect(result.env.PATH).toBe("/usr/bin");
    expect(result.env.SAFE).toBe("remote");
    expect(result.env.NORMAL).toBe("ok");
    expect(result.env.HUSH_TOKEN).toBeUndefined();
    expect(result.env.HUSH_STATE_DIR).toBeUndefined();
    expect(result.env.NODE_OPTIONS).toBeUndefined();
    expect(result.env.HTTPS_PROXY).toBeUndefined();
    expect(result.blocked).toEqual(["HUSH_STATE_DIR", "HUSH_TOKEN", "NODE_OPTIONS", "HTTPS_PROXY"]);
    expect(result.injected).toBe(2);
  });

  it("cannot re-enable a blocked key with --only", () => {
    const result = buildChildEnv({
      parent: {},
      remote,
      only: new Set(["HUSH_TOKEN"]),
      except: new Set(),
      noInherit: true,
    });
    expect(result.env).toEqual({});
    expect(result.blocked).toEqual(["HUSH_TOKEN"]);
    expect(result.injected).toBe(0);
  });

  it("starts clean with --no-inherit", () => {
    const result = buildChildEnv({
      parent: { PATH: "/usr/bin", HOME: "/home/dev" },
      remote: new Map([["SAFE", "yes"]]),
      only: new Set(),
      except: new Set(),
      noInherit: true,
    });
    expect(result.env).toEqual({ SAFE: "yes" });
    expect(result.injected).toBe(1);
  });

  it("blocks prefixes, not just an exact list", () => {
    expect(isBlockedRemoteEnv("LD_PRELOAD")).toBe(true);
    expect(isBlockedRemoteEnv("BASH_FUNC_echo%%")).toBe(true);
    expect(isBlockedRemoteEnv("NPM_CONFIG_SCRIPT_SHELL")).toBe(true);
    expect(isBlockedRemoteEnv("hush_api_url")).toBe(true);
    expect(isBlockedRemoteEnv("SAFE_KEY")).toBe(false);
  });
});
