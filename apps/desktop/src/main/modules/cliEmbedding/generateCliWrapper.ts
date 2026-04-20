import { chmod, mkdir, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app } from 'electron';

import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:cliEmbedding');

/**
 * Resolve the correct Electron binary path per platform.
 * - AppImage: use APPIMAGE env var (the actual .AppImage file)
 * - Others: app.getPath('exe')
 */
function resolveElectronBinary(): string {
  if (process.platform === 'linux' && process.env.APPIMAGE) {
    return process.env.APPIMAGE;
  }
  return app.getPath('exe');
}

/**
 * Resolve the CLI script path inside packaged resources.
 */
function resolveCliScript(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'lobe-cli.js');
  }
  // Dev mode: app.getAppPath() points to apps/desktop/, go up to apps/cli/
  return path.join(app.getAppPath(), '..', 'cli', 'dist', 'index.js');
}

/**
 * Get the user-writable bin directory for CLI wrapper.
 */
export function getCliWrapperDir(): string {
  return path.join(app.getPath('userData'), 'bin');
}

/**
 * Generate shell wrapper scripts that invoke the embedded CLI
 * using Electron's Node.js runtime via ELECTRON_RUN_AS_NODE=1.
 *
 * Called on every app launch to keep paths up-to-date after auto-updates.
 */
export async function generateCliWrapper(): Promise<void> {
  const electronBin = resolveElectronBinary();
  const cliScript = resolveCliScript();
  const wrapperDir = getCliWrapperDir();

  await mkdir(wrapperDir, { recursive: true });

  if (process.platform === 'win32') {
    const content = [
      '@echo off',
      'set ELECTRON_RUN_AS_NODE=1',
      `"${electronBin}" "${cliScript}" %*`,
    ].join('\r\n');

    const cmdPath = path.join(wrapperDir, 'lobehub.cmd');
    await atomicWrite(cmdPath, content);

    // Create short aliases: lh.cmd, lobe.cmd (copies on Windows, symlinks unreliable)
    for (const alias of ['lh.cmd', 'lobe.cmd']) {
      await atomicWrite(path.join(wrapperDir, alias), content);
    }

    logger.info(`CLI wrapper generated: ${cmdPath}`);
  } else {
    const content = [
      '#!/bin/sh',
      `ELECTRON_RUN_AS_NODE=1 exec "${electronBin}" "${cliScript}" "$@"`,
    ].join('\n');

    const wrapperPath = path.join(wrapperDir, 'lobehub');
    await atomicWrite(wrapperPath, content);
    await chmod(wrapperPath, 0o755);

    // Create short aliases: lh, lobe → lobehub
    for (const alias of ['lh', 'lobe']) {
      const linkPath = path.join(wrapperDir, alias);
      await unlink(linkPath).catch(() => {});
      await symlink('lobehub', linkPath);
    }

    logger.info(`CLI wrapper generated: ${wrapperPath}`);
  }
}

/**
 * Atomic write: write to temp file then rename to avoid partial reads.
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  await writeFile(tmpPath, content, 'utf8');
  await rename(tmpPath, filePath);
}
