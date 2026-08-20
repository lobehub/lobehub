import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLI_PRODUCT_NAME } from '../constants/identity';

/** Directory names the sandbox backend uses for its per-architecture builds. */
const ARCH_DIR: Partial<Record<string, string>> = { arm64: 'arm64', x64: 'x64' };

/**
 * Where the backend's own resolver looks — relative to ITS package — versus
 * where a bundled build actually has the file.
 *
 * `getSrtWinPath()` resolves from the module's own location, which stops being
 * meaningful once that module is bundled into somebody else's single-file
 * output: it then points two levels above the bundle, at whatever happens to be
 * there. A distribution that ships the helper alongside its own binary has to
 * say so, which is what `LOBE_SRT_WIN_PATH` exists for.
 *
 * Both layouts are checked because the bundle's depth is a build detail, not a
 * contract: `dist/index.js` puts the package root one level up, and a flat
 * build puts it right here.
 */
const candidateRoots = (): string[] => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [path.resolve(here, '..'), here];
};

/**
 * The sandbox helper shipped inside this CLI package, if this build ships one.
 *
 * Returns undefined on any non-Windows host, on an architecture with no
 * prebuilt helper, and — the ordinary case upstream — when the package simply
 * does not vendor it. Nothing changes for a build that ships no helper.
 */
export const bundledSrtWinPath = (): string | undefined => {
  if (process.platform !== 'win32') return undefined;

  const arch = ARCH_DIR[process.arch];
  if (!arch) return undefined;

  for (const root of candidateRoots()) {
    const candidate = path.join(root, 'vendor', 'srt-win', arch, 'srt-win.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
};

/**
 * Tell the sandbox backend where this build's own files are, and go by.
 *
 * Two things, both of which the backend cannot work out for itself once its
 * code is bundled into someone else's binary:
 *
 * - the helper this package ships, if it ships one;
 * - the name to put on the `ProgramData` directory it stages that helper into,
 *   which is created on the end user's machine and stays there.
 *
 * An existing value always wins in both cases: it was set deliberately by an
 * operator or an embedder, and silently overriding it would make the documented
 * override the one thing that does not work.
 *
 * Called before the probe and before setup, rather than at import time — this
 * reaches into the environment, and doing that as a side effect of loading a
 * module would make it fire for every command, including the ones that never go
 * near a sandbox.
 */
export const applySandboxHostPaths = (): void => {
  if (!process.env.LOBE_SANDBOX_STAGING_NAME) {
    process.env.LOBE_SANDBOX_STAGING_NAME = CLI_PRODUCT_NAME;
  }

  if (process.env.LOBE_SRT_WIN_PATH) return;

  const bundled = bundledSrtWinPath();
  if (bundled) process.env.LOBE_SRT_WIN_PATH = bundled;
};
