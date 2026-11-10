import { describe, expect, it } from "vitest";
import { formatEnvExport, parseExportFormat } from "../src/lib/export-format";

const CONTENT = "A=1\nB=two words\nC='single quoted'\n";

describe("formatEnvExport", () => {
  it("keeps dotenv content as-is and adds a trailing newline", () => {
    expect(formatEnvExport("A=1", "dotenv")).toBe("A=1\n");
    expect(formatEnvExport(CONTENT, "dotenv")).toBe(CONTENT);
  });

  it("renders a JSON object", () => {
    expect(JSON.parse(formatEnvExport(CONTENT, "json"))).toEqual({
      A: "1",
      B: "two words",
      C: "single quoted",
    });
  });

  it("renders shell exports with safe quoting", () => {
    const rendered = formatEnvExport("A=1\nB=two words\nC=it's\n", "shell");
    expect(rendered).toContain("export A=1");
    expect(rendered).toContain("export B='two words'");
    expect(rendered).toContain("export C='it'\\''s'");
  });

  it("rejects an unknown format", () => {
    expect(() => parseExportFormat("yaml")).toThrow();
    expect(parseExportFormat("json")).toBe("json");
  });
});
