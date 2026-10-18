import { EXIT_CODES } from "@hush/schemas";

/** Errors raised by the CLI itself (not the API), with the right exit code. */
export class CliError extends Error {
  readonly exitCode: number;
  readonly hint?: string;

  constructor(message: string, exitCode: number = EXIT_CODES.ERROR, hint?: string) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.hint = hint;
  }

  static usage(message: string, hint?: string): CliError {
    return new CliError(message, EXIT_CODES.USAGE, hint);
  }

  static auth(message: string, hint?: string): CliError {
    return new CliError(message, EXIT_CODES.AUTH, hint);
  }

  static conflict(message: string, hint?: string): CliError {
    return new CliError(message, EXIT_CODES.CONFLICT, hint);
  }
}
