import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveCliDirName } from '../constants/identity';

/**
 * Fallback working directory for a fenced run that arrived without one.
 *
 * The fence is scoped to the run's working directory, so a run with no
 * directory has nothing to scope to. The desktop refuses outright in that case;
 * a connected CLI cannot, because it is a background daemon and there is no one
 * to show the refusal to — the agent would just see every command fail.
 *
 * `process.cwd()` is not an option either: for a daemon that is wherever
 * `connect` happened to be started, usually the user's home or `/`. Fencing
 * writes to *that* would be a fence in name only.
 *
 * So the device offers a directory of its own. It is per-device rather than
 * per-agent — unlike the desktop, which keys this by agentId — because the tool
 * call arriving over the gateway carries no agent identity (see
 * `ToolCallRequestMessage`). Agents sharing this directory can see each other's
 * scratch files; that is a real limitation and the reason a configured working
 * directory is still the right answer for anything that matters.
 */
export const sandboxWorkspacePath = (): string =>
  path.join(os.homedir(), resolveCliDirName(), 'sandbox', 'default');

/**
 * Create the fallback workspace and return its **real** path.
 *
 * Symlinks are resolved because the policy layer compares realpaths — on macOS
 * `os.homedir()` under some setups, and `/tmp` generally, are symlinks, and a
 * fence rooted at the unresolved path would not match the paths the sandbox
 * actually sees.
 */
export const ensureSandboxWorkspace = (): string => {
  const target = sandboxWorkspacePath();
  fs.mkdirSync(target, { mode: 0o700, recursive: true });
  return fs.realpathSync(target);
};
