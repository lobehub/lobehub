import { readFileSync, rmSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  APP_HANDOFF_PROTOCOL_VERSION,
  type AppHandoffChannel,
  type AppHandoffDiscovery,
} from './protocol';

/**
 * Directory native apps look in to find a running, signed-in desktop app.
 * Under the user's home and private to them (0700), so another OS user can
 * neither read the port nor plant a file pointing at their own listener.
 */
export const getDiscoveryDir = (homeDir = os.homedir()) =>
  path.join(homeDir, '.lobehub', 'desktop-handoff');

export const channelFromScheme = (scheme: string): AppHandoffChannel => {
  if (scheme.includes('nightly')) return 'nightly';
  if (scheme.includes('beta')) return 'beta';
  if (scheme.endsWith('-dev')) return 'dev';
  return 'stable';
};

export const getDiscoveryFile = (channel: AppHandoffChannel, dir = getDiscoveryDir()) =>
  path.join(dir, `${channel}.json`);

/**
 * Publishes where the interface listens. Holds no token and no user data: a
 * reader learns only that a desktop app for this issuer is running.
 */
export const writeDiscoveryFile = async (
  entry: Omit<AppHandoffDiscovery, 'v'>,
  dir = getDiscoveryDir(),
) => {
  await mkdir(dir, { mode: 0o700, recursive: true });
  // mkdir's mode is masked by umask and ignored for an existing directory.
  if (process.platform !== 'win32') await chmod(dir, 0o700);

  const file = getDiscoveryFile(entry.channel, dir);
  const temp = `${file}.${process.pid}.tmp`;
  const content: AppHandoffDiscovery = { ...entry, v: APP_HANDOFF_PROTOCOL_VERSION };
  await writeFile(temp, JSON.stringify(content), { mode: 0o600 });
  await rename(temp, file);
  return file;
};

/** Removes the file, but only while it still describes this process. */
export const removeDiscoveryFile = async (
  channel: AppHandoffChannel,
  dir = getDiscoveryDir(),
  pid = process.pid,
) => {
  const file = getDiscoveryFile(channel, dir);
  try {
    const current = JSON.parse(await readFile(file, 'utf8')) as Partial<AppHandoffDiscovery>;
    if (current.pid !== pid) return false;
  } catch {
    return false;
  }
  await rm(file, { force: true });
  return true;
};

/**
 * Synchronous {@link removeDiscoveryFile} for `will-quit`: the process exits
 * before an awaited removal would finish, leaving a file that points at a
 * closed port.
 */
export const removeDiscoveryFileSync = (
  channel: AppHandoffChannel,
  dir = getDiscoveryDir(),
  pid = process.pid,
) => {
  const file = getDiscoveryFile(channel, dir);
  try {
    const current = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppHandoffDiscovery>;
    if (current.pid !== pid) return false;
    rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
};
