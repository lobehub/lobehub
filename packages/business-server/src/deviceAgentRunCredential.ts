import type { AgentRunCredential } from '@lobechat/types';

import type { ManagedDeviceScope } from './managedDevice';

/**
 * Credentials a deployment hands individual agent runs on devices. The
 * open-source build supplies none; a deployment that does overrides this
 * module through its own `@/business/server/...` mapping.
 */

/** An agent run about to be dispatched to a device. */
export interface DeviceAgentRunCredentialRequest extends ManagedDeviceScope {
  agentId?: string;
  /** The heterogeneous agent type, e.g. `claude-code`. */
  agentType: string;
  /** `devices.deviceId` the run is dispatched to. */
  deviceId: string;
}

/**
 * A credential the deployment supplies for one agent run, sent with the run
 * request instead of being installed on the device: the device uses it for
 * that run only and does not store it. `undefined` leaves the device on
 * whatever login it has. A rejection fails the dispatch.
 */
export const resolveDeviceAgentRunCredential = async (
  _request: DeviceAgentRunCredentialRequest,
): Promise<AgentRunCredential | undefined> => undefined;
