import { parseEnvContent } from "./dotenv-file";

export type ExportFormat = "dotenv" | "json" | "shell";

export function parseExportFormat(value: string): ExportFormat {
  if (value === "dotenv" || value === "json" || value === "shell") {
    return value;
  }
  throw new Error(`Unsupported format "${value}". Use dotenv, json or shell.`);
}

function shellValue(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]*$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Render decrypted env content for a downstream tool. */
export function formatEnvExport(content: string, format: ExportFormat): string {
  if (format === "dotenv") {
    return content.endsWith("\n") ? content : `${content}\n`;
  }
  const parsed = parseEnvContent(content);
  if (format === "json") {
    return `${JSON.stringify(Object.fromEntries(parsed.vars), null, 2)}\n`;
  }
  return `${parsed.entries
    .map((entry) => `export ${entry.key}=${shellValue(entry.value)}`)
    .join("\n")}\n`;
}
