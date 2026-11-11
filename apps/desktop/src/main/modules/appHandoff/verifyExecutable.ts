import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { type RunCommand, runCommand } from './peerProcess';

/** What the server lists for a handoff target, per platform. Mirrors `NativeHandoffTargetVerification`. */
export interface AppHandoffVerification {
  linux?: { exeDirs: string[] };
  mac?: { designatedRequirement: string };
  win?: { signerSubject: string };
}

export interface VerifyDeps {
  platform?: NodeJS.Platform;
  run?: RunCommand;
  stat?: typeof stat;
}

/** `/Applications/X.app/Contents/MacOS/X` → `/Applications/X.app`; `undefined` outside a bundle. */
export const macBundlePath = (exePath: string) => {
  const index = exePath.indexOf('.app/Contents/MacOS/');
  return index === -1 ? undefined : exePath.slice(0, index + 4);
};

const verifyMac = async (exePath: string, requirement: string, run: RunCommand) => {
  const bundle = macBundlePath(exePath);
  if (!bundle) return false;
  try {
    // Non-zero exit (unsigned, modified, other identity or team) rejects.
    await run('codesign', ['--verify', '--strict', `-R=${requirement}`, bundle]);
    return true;
  } catch {
    return false;
  }
};

const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;

const verifyWindows = async (exePath: string, signerSubject: string, run: RunCommand) => {
  const script = `$s = Get-AuthenticodeSignature -FilePath ${psQuote(exePath)}; @{ status = [string]$s.Status; subject = $s.SignerCertificate.Subject } | ConvertTo-Json -Compress`;
  try {
    const output = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
    const parsed = JSON.parse(output.trim()) as { status?: string; subject?: string };
    return parsed.status === 'Valid' && parsed.subject === signerSubject;
  } catch {
    return false;
  }
};

/**
 * Linux has no code signature to check, so the bar is the install location:
 * the executable resolves inside a listed directory, and it and every
 * directory above it is owned by root and not writable by group or others.
 * A user-writable copy (AppImage in ~/Downloads, a dev build) does not pass and
 * falls back to the confirmation dialog.
 */
const verifyLinux = async (exePath: string, exeDirs: string[], statFn: typeof stat) => {
  let resolved: string;
  try {
    resolved = await realpath(exePath);
  } catch {
    return false;
  }
  const insideListed = exeDirs.some((dir) => {
    const relative = path.relative(dir, resolved);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
  if (!insideListed) return false;

  for (let current = resolved; ; current = path.dirname(current)) {
    try {
      const info = await statFn(current);
      if (info.uid !== 0 || (info.mode & 0o022) !== 0) return false;
    } catch {
      return false;
    }
    if (current === path.dirname(current)) return true;
  }
};

/**
 * True when the executable is the published build of the target app on this
 * platform. `false` covers "cannot tell" too (no metadata for this platform,
 * unsigned build): the caller then asks the user instead of refusing.
 */
export const verifyExecutable = async (
  exePath: string | undefined,
  verification: AppHandoffVerification | undefined,
  deps: VerifyDeps = {},
) => {
  if (!exePath || !verification) return false;
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? runCommand;

  if (platform === 'darwin' && verification.mac) {
    return verifyMac(exePath, verification.mac.designatedRequirement, run);
  }
  if (platform === 'win32' && verification.win) {
    return verifyWindows(exePath, verification.win.signerSubject, run);
  }
  if (platform === 'linux' && verification.linux) {
    return verifyLinux(exePath, verification.linux.exeDirs, deps.stat ?? stat);
  }
  return false;
};
