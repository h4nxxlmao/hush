import { describe, expect, it } from "vitest";
import {
  canonicalizeEnvContent,
  compareWithExample,
  diffEnvs,
  formatChangeSummary,
  maskValue,
  parseEnvContent,
} from "../src/lib/dotenv-file";
import { ensureGitignoreEntries, checkGitignore } from "../src/lib/gitignore";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * .env parsing edge cases and diff semantics. These are the sharp edges that
 * silently corrupt real files if wrong: quotes, multiline values, comments,
 * `export` prefixes and empty values.
 */

describe("parseEnvContent", () => {
  it("handles plain, quoted and empty values", () => {
    const parsed = parseEnvContent(
      [
        "PLAIN=value",
        'SINGLE=\'single quoted\'',
        'DOUBLE="double quoted"',
        "EMPTY=",
        "EMPTY_QUOTED=\"\"",
        "SPACES=  padded  ",
      ].join("\n"),
    );
    expect(parsed.vars.get("PLAIN")).toBe("value");
    expect(parsed.vars.get("SINGLE")).toBe("single quoted");
    expect(parsed.vars.get("DOUBLE")).toBe("double quoted");
    expect(parsed.vars.get("EMPTY")).toBe("");
    expect(parsed.vars.get("EMPTY_QUOTED")).toBe("");
    expect(parsed.vars.get("SPACES")).toBe("padded");
  });

  it("handles the export prefix", () => {
    const parsed = parseEnvContent("export EXPORTED=yes\nNORMAL=also\n");
    expect(parsed.vars.get("EXPORTED")).toBe("yes");
    expect(parsed.vars.get("NORMAL")).toBe("also");
  });

  it("handles multiline double-quoted values", () => {
    const parsed = parseEnvContent('KEY="line one\nline two"\nNEXT=x\n');
    expect(parsed.vars.get("KEY")).toBe("line one\nline two");
    expect(parsed.vars.get("NEXT")).toBe("x");
  });

  it("ignores comments and blank lines", () => {
    const parsed = parseEnvContent("# a comment\n\n#ANOTHER=ignored\nREAL=yes\n");
    expect(parsed.vars.has("# a comment")).toBe(false);
    expect(parsed.vars.has("ANOTHER")).toBe(false);
    expect(parsed.vars.get("REAL")).toBe("yes");
    expect(parsed.entries).toHaveLength(1);
  });

  it("keeps file order in entries and drops duplicates", () => {
    const parsed = parseEnvContent("B=2\nA=1\nB=3\n");
    expect(parsed.entries.map((entry) => entry.key)).toEqual(["B", "A"]);
    expect(parsed.vars.get("B")).toBe("3");
  });

  it("expands \\n inside double-quoted values (dotenv semantics)", () => {
    // In the file this is a literal backslash-n inside quotes.
    const parsed = parseEnvContent('MULTI="a\\nb"\n');
    expect(parsed.vars.get("MULTI")).toBe("a\nb");
    // dotenv does not unescape backslash-quote pairs; pin that so a swap of the
    // parser can never silently change what we encrypt.
    const quoted = parseEnvContent('ESCAPED="say \\"hi\\""\n');
    expect(quoted.vars.get("ESCAPED")).toBe('say \\"hi\\"');
  });
});

describe("canonicalizeEnvContent", () => {
  it("normalizes line endings and the trailing newline", () => {
    expect(canonicalizeEnvContent("A=1\r\nB=2")).toBe("A=1\nB=2\n");
    expect(canonicalizeEnvContent("A=1\n\n\n")).toBe("A=1\n");
    expect(canonicalizeEnvContent("A=1\n")).toBe("A=1\n");
  });
});

describe("diffEnvs and summaries", () => {
  const from = parseEnvContent("A=1\nB=2\nC=3\n");
  const to = parseEnvContent("A=1\nB=changed\nD=4\n");

  it("reports added, removed, changed and unchanged", () => {
    const diff = diffEnvs(from, to);
    expect(diff.added).toEqual(["D"]);
    expect(diff.removed).toEqual(["C"]);
    expect(diff.changed).toEqual([{ key: "B", from: "2", to: "changed" }]);
    expect(diff.unchanged).toBe(1);
  });

  it("formats +3 ~1 -2 style summaries", () => {
    const diff = diffEnvs(parseEnvContent("KEEP=1\nGONE=2\n"), parseEnvContent("KEEP=1\nNEW1=a\nNEW2=b\nNEW3=c\nCHANGED=x\n"));
    expect(formatChangeSummary(diff)).toBe("+4 -1");
    const richer = diffEnvs(parseEnvContent("A=1\nB=2\nC=3\n"), parseEnvContent("A=9\nB=2\nC=3\nD=4\n"));
    expect(formatChangeSummary(richer)).toBe("+1 ~1");
  });

  it("says No changes. when nothing moved", () => {
    expect(formatChangeSummary(diffEnvs(from, from))).toBe("No changes.");
  });
});

describe("masking", () => {
  it("masks by default and reveals on request", () => {
    expect(maskValue("super-secret", false)).toBe("••••••••");
    expect(maskValue("super-secret", true)).toBe("super-secret");
    expect(maskValue("", false)).toBe("••••••••");
  });
});

describe("compareWithExample", () => {
  it("finds missing and extra keys", () => {
    const example = parseEnvContent("DATABASE_URL=\nAPI_KEY=\nPORT=\n");
    const actual = parseEnvContent("DATABASE_URL=x\nPORT=3000\nEXTRA=1\n");
    const result = compareWithExample(example, actual);
    expect(result.missing).toEqual(["API_KEY"]);
    expect(result.extra).toEqual(["EXTRA"]);
  });
});

describe("gitignore helper", () => {
  it("adds the entries once and reports coverage", () => {
    const dir = mkdtempSync(join(tmpdir(), "hush-gitignore-"));
    const first = ensureGitignoreEntries(dir);
    expect(first.added).toEqual([".env", ".env.*", "!.env.example"]);
    const second = ensureGitignoreEntries(dir);
    expect(second.added).toEqual([]);
    expect(checkGitignore(dir).covered).toBe(true);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("!.env.example");

    // An existing .gitignore is preserved.
    writeFileSync(join(dir, ".gitignore"), "node_modules\n", "utf8");
    const third = ensureGitignoreEntries(dir);
    expect(third.added).toEqual([".env", ".env.*", "!.env.example"]);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("node_modules");
  });
});
