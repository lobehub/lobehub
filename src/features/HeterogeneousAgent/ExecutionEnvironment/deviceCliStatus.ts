import type { HeterogeneousAgentScanMap } from '@lobechat/heterogeneous-agents';
import { coerce, gt } from 'semver';

import type { getBoundDevicePresence } from './boundDevicePresence';

export type DeviceCliState =
  | { status: 'available'; updatable?: boolean; version?: string }
  | { status: 'checking' }
  | { status: 'deviceMissing' }
  | { status: 'offline' }
  | { reason?: string; status: 'scanFailed' }
  | { status: 'unavailable' };

interface ResolveDeviceCliStateParams {
  agentType: string;
  presence: ReturnType<typeof getBoundDevicePresence>;
  scan?: { agents: HeterogeneousAgentScanMap; error?: string } | null;
  scanError?: unknown;
}

/**
 * What the profile can honestly say about an agent CLI on its bound device.
 *
 * Only an online device that answered the scan can report the CLI as missing.
 * An offline device, a failed scan, or a device client too old to know this
 * agent type all stay distinct from "not installed", so the profile never
 * sends someone off to install a CLI that may already be there.
 */
export const resolveDeviceCliState = ({
  agentType,
  presence,
  scan,
  scanError,
}: ResolveDeviceCliStateParams): DeviceCliState => {
  if (presence === 'none' || presence === 'missing') return { status: 'deviceMissing' };
  if (presence === 'checking') return { status: 'checking' };
  if (presence === 'offline') return { status: 'offline' };

  const failure = scanError
    ? scanError instanceof Error
      ? scanError.message
      : String(scanError)
    : scan?.error;
  if (failure) return { reason: failure, status: 'scanFailed' };
  if (!scan) return { status: 'checking' };

  const entry = scan.agents[agentType as keyof HeterogeneousAgentScanMap];
  // Older device clients leave out types they predate: no answer, not "missing".
  if (!entry) return { status: 'scanFailed' };

  return entry.available
    ? { status: 'available', updatable: entry.updatable, version: entry.version }
    : { status: 'unavailable' };
};

/**
 * The newer release a device's CLI can move to, or `undefined` when it is
 * already current or either version cannot be read. Coerced so a version
 * string with a suffix (`2.1.0 (Claude Code)`) still compares.
 */
export const getNewerAgentCliVersion = (
  current: string | undefined,
  latest: string | null | undefined,
): string | undefined => {
  const currentVersion = current ? coerce(current, { includePrerelease: true }) : null;
  const latestVersion = latest ? coerce(latest, { includePrerelease: true }) : null;
  if (!currentVersion || !latestVersion) return undefined;
  return gt(latestVersion, currentVersion) ? latestVersion.version : undefined;
};

/**
 * Install or update commands that can run on the device's OS. Homebrew is
 * offered as the macOS alternative, so it is dropped for a known non-macOS
 * device.
 */
export const getDeviceCommands = (
  commands: readonly string[],
  platform: string | null | undefined,
): string[] =>
  platform && platform !== 'darwin'
    ? commands.filter((command) => !command.trimStart().startsWith('brew '))
    : [...commands];
