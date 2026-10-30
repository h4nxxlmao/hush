// SPDX-License-Identifier: GPL-3.0-only
import { defineCommand } from "citty";
import { checkCommand } from "./commands/check";
import { completionCommand } from "./commands/completion";
import { diffCommand } from "./commands/diff";
import { doctorCommand } from "./commands/doctor";
import { exampleCommand } from "./commands/example";
import { historyCommand } from "./commands/history";
import { initCommand } from "./commands/init";
import { inviteCommand } from "./commands/invite";
import { keyCommand } from "./commands/key";
import { leaveCommand } from "./commands/leave";
import { lockCommand } from "./commands/lock";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { lsCommand } from "./commands/ls";
import { membersCommand } from "./commands/members";
import { pullCommand } from "./commands/pull";
import { pushCommand } from "./commands/push";
import { revokeCommand } from "./commands/revoke";
import { rollbackCommand } from "./commands/rollback";
import { runCommand } from "./commands/run";
import { unlockCommand } from "./commands/unlock";
import { useCommand } from "./commands/use";
import { whoamiCommand } from "./commands/whoami";
import { globalArgs } from "./lib/command";
import { version } from "./lib/version";

export const mainCommand = defineCommand({
  meta: {
    name: "hush",
    version,
    description:
      "Your .env, everywhere. Encrypted before it leaves your machine.",
  },
  args: globalArgs,
  subCommands: {
    login: loginCommand,
    logout: logoutCommand,
    whoami: whoamiCommand,
    init: initCommand,
    push: pushCommand,
    pull: pullCommand,
    diff: diffCommand,
    check: checkCommand,
    run: runCommand,
    use: useCommand,
    example: exampleCommand,
    ls: lsCommand,
    history: historyCommand,
    rollback: rollbackCommand,
    invite: inviteCommand,
    members: membersCommand,
    revoke: revokeCommand,
    leave: leaveCommand,
    key: keyCommand,
    lock: lockCommand,
    unlock: unlockCommand,
    doctor: doctorCommand,
    completion: completionCommand,
  },
});
