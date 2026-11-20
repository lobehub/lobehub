import { isLocalRuntimeHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type { DeviceExecutionTarget } from '@lobechat/types';

export type HeteroProfilePanel =
  /** Claude Code's cloud sandbox: token, GitHub credential and repositories. */
  | { kind: 'cloud' }
  /** The CLI on a gateway-routed device, probed through the device gateway. */
  | { deviceId: string; kind: 'device' }
  /** The CLI on this desktop, probed over Electron IPC. */
  | { kind: 'local' }
  /** No environment to describe yet: the picker asks for one. */
  | { kind: 'pending' }
  /** A bundled runtime with nothing installed per machine. */
  | { kind: 'runtime' }
  /** A cloud sandbox run with nothing to configure here. */
  | { kind: 'sandbox' };

/**
 * Which configuration panel a heterogeneous agent's profile shows.
 *
 * Decided by where the agent's new topics run — never by the client the profile
 * is open on. A desktop showing a device-bound agent must describe that device,
 * not probe its own PATH.
 */
export const resolveHeteroProfilePanel = ({
  deviceId,
  providerType,
  target,
}: {
  deviceId?: string;
  providerType?: string;
  target: DeviceExecutionTarget;
}): HeteroProfilePanel => {
  if (!providerType) return { kind: 'pending' };
  if (isLocalRuntimeHeterogeneousType(providerType)) return { kind: 'runtime' };

  switch (target) {
    case 'local': {
      return { kind: 'local' };
    }
    case 'sandbox': {
      return providerType === 'claude-code' ? { kind: 'cloud' } : { kind: 'sandbox' };
    }
    case 'device': {
      return deviceId ? { deviceId, kind: 'device' } : { kind: 'pending' };
    }
    default: {
      return { kind: 'pending' };
    }
  }
};
