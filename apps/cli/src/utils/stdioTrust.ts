import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveCliDirName } from '../constants/identity';

export interface StdioLaunch {
  args?: string[];
  command: string;
  env?: Record<string, string>;
}

/**
 * stdio launches the user approved on this machine, keyed by server + connector
 * id. The connector row's creator says nothing about who wrote its current
 * command — a workspace owner can overwrite it (`add --force`, web edit) while
 * `userId` stays put — so only a launch approved here may run unprompted.
 */
const trustFile = () => path.join(os.homedir(), resolveCliDirName(), 'trusted-stdio-commands.json');

/** Digest of everything that decides what runs: command, argv and env. */
export function hashStdioLaunch(launch: StdioLaunch): string {
  const env = Object.entries(launch.env ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256')
    .update(JSON.stringify([launch.command, launch.args ?? [], env]))
    .digest('hex');
}

function load(): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(trustFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function isStdioLaunchTrusted(key: string, launch: StdioLaunch): boolean {
  return load()[key] === hashStdioLaunch(launch);
}

export function trustStdioLaunch(key: string, launch: StdioLaunch): void {
  const file = trustFile();
  fs.mkdirSync(path.dirname(file), { mode: 0o700, recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...load(), [key]: hashStdioLaunch(launch) }, null, 2), {
    mode: 0o600,
  });
}
