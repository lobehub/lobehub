import {
  getSrtWinPath,
  getWindowsSandboxUserStatus,
  getWindowsWfpStatus,
  resolveSrtWin,
  SandboxManager,
  windowsInstallInstructions,
} from '@anthropic-ai/sandbox-runtime';

import { resolveEffectiveSrtWin } from './srtWinStaging';
import type { SandboxCapability } from './types';

const unavailable = (reason: string, warnings?: string[]): SandboxCapability => ({
  available: false,
  backend: 'none',
  networkIsolation: false,
  reason,
  warnings,
});

/**
 * Windows readiness, checked against the helper *this app actually ships*.
 *
 * `SandboxManager.checkDependencies()` cannot be used here: it resolves the
 * helper through the backend's own `getSrtWinPath()`, which is relative to the
 * backend's package directory. Once that package is bundled into the main
 * process, the computed path points inside `app.asar` — where no file exists —
 * so a correctly installed app reported "srt-win.exe not found" and offered a
 * Set-up button that could never change the answer. Observed on a released
 * build whose `resources/sandbox-runtime/vendor/` held the binary all along.
 *
 * So the checks are run directly against the resolved path instead, mirroring
 * the backend's own sequence: binary present → sandbox user provisioned with a
 * readable credential → WFP filters installed. `cannot-read` on the filter
 * enumeration is not a failure — it is admin-gated, and the behavioural egress
 * check at `initialize()` is what actually fails closed.
 */
const probeWindows = (): SandboxCapability => {
  // Exactly the path the launch will use: `resolveEffectiveSrtWin` is the one
  // place that resolves and stages, so the probe can never bless a path the
  // launch would not take.
  const path = resolveEffectiveSrtWin(getSrtWinPath);
  if (!path) {
    return unavailable(`Sandbox helper not found. ${windowsInstallInstructions(undefined)}`);
  }

  const srtWin = resolveSrtWin({ path });

  let user;
  try {
    user = getWindowsSandboxUserStatus({ srtWin });
  } catch (error) {
    return unavailable(`srt-win user status failed: ${(error as Error).message}`);
  }

  if (!user.provisioned || !user.credPresent) {
    return unavailable(
      `Sandbox user is not provisioned (user=${user.provisioned}, cred=${user.credPresent}).`,
    );
  }

  try {
    const wfp = getWindowsWfpStatus({ srtWin });
    // `absent` is the only real failure: `cannot-read` just means the caller is
    // not elevated enough to enumerate BFE filters.
    if (wfp.state !== 'installed' && wfp.state !== 'cannot-read') {
      return unavailable('WFP filters are not installed.');
    }
  } catch (error) {
    return unavailable(`srt-win wfp status failed: ${(error as Error).message}`);
  }

  return { available: true, backend: 'srt', networkIsolation: true };
};

export const probeSandboxCapability = async (): Promise<SandboxCapability> => {
  if (!SandboxManager.isSupportedPlatform()) {
    return unavailable(`Sandbox Runtime does not support ${process.platform}`);
  }

  if (process.platform === 'win32') return probeWindows();

  // macOS ships Seatbelt with the OS and Linux's dependencies are ordinary
  // system packages resolved from PATH, so neither is affected by where this
  // app happens to be installed — the backend's own check is accurate there.
  const dependencies = SandboxManager.checkDependencies();
  if (dependencies.errors.length > 0) {
    return unavailable(
      `Sandbox Runtime dependencies are unavailable: ${dependencies.errors.join(', ')}`,
      dependencies.warnings,
    );
  }

  return {
    available: true,
    backend: 'srt',
    networkIsolation: true,
    warnings: dependencies.warnings,
  };
};
