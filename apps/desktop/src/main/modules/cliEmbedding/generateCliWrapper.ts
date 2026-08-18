import { chmod, mkdir, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app } from 'electron';

import { OFFICIAL_CLOUD_SERVER } from '@/const/env';
import { getDesktopEnv } from '@/env';
import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:cliEmbedding');

/**
 * Server the wrapper falls back to, as a shell default rather than an override.
 *
 * The embedded CLI resolves its server from `LOBEHUB_SERVER` first, then its own
 * stored settings, then a compile-time official URL. The spawn paths inside the
 * app (`remoteFileUploadSrv`, the hetero agents) always inject the variable, but
 * these wrappers are what a user runs by hand from a terminal — and they carried
 * no environment at all, so the CLI fell through to the bundled default. In a
 * distribution built against a different server that default is the wrong host.
 *
 * Assigned only when unset, deliberately. Exporting it unconditionally would
 * silently outrank `login --server <url>`, which is a legitimate thing to do and
 * would then appear to succeed against the wrong deployment.
 */
const SERVER_ENV_VAR = 'LOBEHUB_SERVER';

/**
 * Command names the wrapper installs, primary first.
 *
 * Comes from `getDesktopEnv().DESKTOP_CLI_BIN_NAMES` so a distribution that
 * embeds its own CLI build installs shims under ITS command name. Leaving these
 * hardcoded put `lh` / `lobe` / `lobehub` on the path of an app branded as
 * something else — and on a machine that also has the real upstream CLI, the
 * two would fight over the same three names.
 */
const binNames = (): string[] => {
  const configured = getDesktopEnv()
    .DESKTOP_CLI_BIN_NAMES?.split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  return configured?.length ? configured : ['lobehub', 'lh', 'lobe'];
};

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
export function resolveCliScript(): string {
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
      `if "%${SERVER_ENV_VAR}%"=="" set "${SERVER_ENV_VAR}=${OFFICIAL_CLOUD_SERVER}"`,
      `"${electronBin}" "${cliScript}" %*`,
    ].join('\r\n');

    const [primary, ...aliases] = binNames();
    const cmdPath = path.join(wrapperDir, `${primary}.cmd`);
    await atomicWrite(cmdPath, content);

    // Aliases are copies on Windows, where symlinks are unreliable.
    for (const alias of aliases) {
      await atomicWrite(path.join(wrapperDir, `${alias}.cmd`), content);
    }

    logger.info(`CLI wrapper generated: ${cmdPath}`);
  } else {
    const content = [
      '#!/bin/sh',
      `: "\${${SERVER_ENV_VAR}:=${OFFICIAL_CLOUD_SERVER}}"`,
      `export ${SERVER_ENV_VAR}`,
      `ELECTRON_RUN_AS_NODE=1 exec "${electronBin}" "${cliScript}" "$@"`,
    ].join('\n');

    const [primary, ...aliases] = binNames();
    const wrapperPath = path.join(wrapperDir, primary);
    await atomicWrite(wrapperPath, content);
    await chmod(wrapperPath, 0o755);

    for (const alias of aliases) {
      const linkPath = path.join(wrapperDir, alias);
      await unlink(linkPath).catch(() => {});
      await symlink(primary, linkPath);
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
