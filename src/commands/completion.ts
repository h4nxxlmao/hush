import { defineCommand } from "citty";
import { globalArgs, runWithArgs } from "../lib/command";
import { isJsonMode, out, printJson } from "../lib/ui";

/**
 * `hush completion <shell>`, printable completion scripts for bash, zsh and
 * fish. Generated from the same command list the CLI registers, so they cannot
 * drift far.
 */

const COMMANDS = [
  "login",
  "logout",
  "whoami",
  "init",
  "push",
  "pull",
  "diff",
  "check",
  "run",
  "use",
  "example",
  "ls",
  "history",
  "rollback",
  "invite",
  "members",
  "revoke",
  "leave",
  "key",
  "lock",
  "unlock",
  "doctor",
  "completion",
];

const GLOBAL_FLAGS = ["--json", "--no-color", "--api-url", "--yes", "-y", "--help", "-h"];

const COMMAND_FLAGS: Record<string, string[]> = {
  push: ["-e", "--env", "-m", "--message", "--force", "--project", "--dry-run"],
  pull: ["-e", "--env", "-o", "--out", "--force", "--project"],
  diff: ["-e", "--env", "--version", "--reveal", "--exit-code", "--project"],
  check: ["-e", "--env", "--example", "--remote", "--project"],
  run: ["-e", "--env", "--project", "--only", "--except", "--no-inherit"],
  use: ["--project"],
  example: ["-o", "--out", "--force"],
  history: ["-e", "--env", "--limit", "--project"],
  rollback: ["-e", "--env", "-m", "--message", "--project"],
  invite: ["--role", "--project"],
  members: ["--project"],
  revoke: ["--project"],
  leave: ["--project"],
  init: ["--name", "--project", "-e", "--env", "--skip-gitignore"],
  key: ["--out", "--file", "--recovery"],
  completion: ["bash", "zsh", "fish"],
};

function bashScript(): string {
  const commandList = COMMANDS.join(" ");
  const cases = Object.entries(COMMAND_FLAGS)
    .map(([command, flags]) => `      ${command}) opts="${[...flags, ...GLOBAL_FLAGS].join(" ")}" ;;`)
    .join("\n");
  return `# hush bash completion, add to ~/.bashrc:
#   eval "$(hush completion bash)"
_hush_completions() {
  local cur prev command opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  command="\${COMP_WORDS[1]}"
  opts="${GLOBAL_FLAGS.join(" ")}"
  case "$command" in
${cases}
  esac
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${commandList}" -- "$cur") )
  else
    COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
  fi
  return 0
}
complete -F _hush_completions hush
`;
}

function zshScript(): string {
  const cases = Object.entries(COMMAND_FLAGS)
    .map(
      ([command, flags]) =>
        `    (${command}) _arguments ${[...flags, ...GLOBAL_FLAGS]
          .filter((flag) => flag.startsWith("--"))
          .map((flag) => `'${flag}'`)
          .join(" ")} ;;`,
    )
    .join("\n");
  return `#compdef hush
# hush zsh completion, add to ~/.zshrc:
#   eval "$(hush completion zsh)"
_hush() {
  local -a commands
  commands=(${COMMANDS.map((command) => `'${command}'`).join(" ")})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  case "\${words[2]}" in
${cases}
  esac
}
compdef _hush hush
`;
}

function fishScript(): string {
  const lines = COMMANDS.map(
    (command) =>
      `complete -c hush -n "__fish_use_subcommand" -a "${command}"`,
  );
  const flagLines = Object.entries(COMMAND_FLAGS).flatMap(([command, flags]) =>
    flags
      .filter((flag) => flag.startsWith("--"))
      .map(
        (flag) =>
          `complete -c hush -n "__fish_seen_subcommand_from ${command}" -l ${flag.replace(/^--/, "")}`,
      ),
  );
  return `# hush fish completion, add to ~/.config/fish/config.fish:
#   hush completion fish > ~/.config/fish/completions/hush.fish
${[...lines, ...flagLines].join("\n")}
complete -c hush -l json -d "JSON output"
complete -c hush -l no-color -d "Disable colors"
complete -c hush -l api-url -d "Override the API URL"
`;
}

export const completionCommand = defineCommand({
  meta: { name: "completion", description: "Print shell completions (bash, zsh, fish)" },
  args: {
    ...globalArgs,
    shell: { type: "positional", description: "bash | zsh | fish", required: true },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const shell = String(args.shell).toLowerCase();
      const scripts: Record<string, string> = {
        bash: bashScript(),
        zsh: zshScript(),
        fish: fishScript(),
      };
      if (!scripts[shell]) {
        throw new Error(`Unsupported shell "${args.shell}". Use bash, zsh or fish.`);
      }
      if (isJsonMode()) {
        printJson({ shell, script: scripts[shell] });
        return;
      }
      out(scripts[shell]!);
    });
  },
});
