import type { HeterogeneousAgentScanMap } from '@lobechat/heterogeneous-agents';

import type { getBoundDevicePresence } from './boundDevicePresence';

export type DeviceCliState =
  | { status: 'available'; version?: string }
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
    ? { status: 'available', version: entry.version }
    : { status: 'unavailable' };
};

/**
 * Install commands that can run on the device's OS. Homebrew is offered as the
 * macOS alternative, so it is dropped for a known non-macOS device.
 */
export const getDeviceInstallCommands = (
  commands: readonly string[],
  platform: string | null | undefined,
): string[] =>
  platform && platform !== 'darwin'
    ? commands.filter((command) => !command.trimStart().startsWith('brew '))
    : [...commands];
