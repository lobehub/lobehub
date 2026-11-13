import type { DeviceListItem } from '@lobechat/types';

import { isTrpcErrorCode } from '@/utils/trpcError';

export interface AutoEnrollInput {
  /** The device list of the active workspace, only once the server confirmed it. */
  confirmedDevices: DeviceListItem[] | undefined;
  /** This machine has been handled for this workspace before (enrolled, found, or refused). */
  handled: boolean;
  isGatewayConnected: boolean;
  isViewer: boolean;
  personalDeviceId: string | undefined;
  workspaceDeviceId: string | undefined;
  workspaceId: string | null | undefined;
}

/**
 * - `wait` — not enough is known yet; ask again when something changes.
 * - `skip` — nothing to do for this workspace.
 * - `markHandled` — the machine is already in the workspace (shared by hand
 *   or by `lh connect`): remember it, so removing it later is not undone.
 * - `enroll` — share this machine into the workspace as a private device.
 */
export type AutoEnrollDecision = 'enroll' | 'markHandled' | 'skip' | 'wait';

/**
 * Whether the desktop should put itself into the active workspace as the
 * member's private device.
 *
 * Only the workspace the user is in right now is enrolled — each enrollment is
 * one more gateway connection. A machine handled once for a workspace is never
 * enrolled again: if its row is gone, the user removed it.
 */
export const decideAutoEnroll = ({
  confirmedDevices,
  handled,
  isGatewayConnected,
  isViewer,
  personalDeviceId,
  workspaceDeviceId,
  workspaceId,
}: AutoEnrollInput): AutoEnrollDecision => {
  if (!workspaceId) return 'skip';
  // Enrolling writes the shared device pool, which viewers may not do.
  if (isViewer) return 'skip';
  if (handled) return 'skip';
  // The share travels over the personal gateway connection.
  if (!isGatewayConnected || !personalDeviceId || !workspaceDeviceId) return 'wait';
  // A stored list may miss a row the server has; only the confirmed one decides.
  if (!confirmedDevices) return 'wait';

  return confirmedDevices.some((device) => device.deviceId === workspaceDeviceId)
    ? 'markHandled'
    : 'enroll';
};

/**
 * A refusal that will not change on retry: another member keeps this machine
 * private in the workspace, or the machine is a managed device (both CONFLICT).
 * It is skipped silently and not tried again. Anything else — the device
 * dropped offline, a network error, a role still loading — is retried in a
 * later app session.
 */
export const isPermanentEnrollRefusal = (error: unknown): boolean =>
  isTrpcErrorCode(error, 'CONFLICT');

const STORAGE_PREFIX = 'LOBE_WORKSPACE_DEVICE_AUTO_ENROLLED';

/**
 * Keyed by the personal device id, which already encodes both the machine and
 * the account, so a second account on the same computer keeps its own record.
 */
export const autoEnrollStorageKey = (personalDeviceId: string, workspaceId: string) =>
  `${STORAGE_PREFIX}:${personalDeviceId}:${workspaceId}`;

export const readAutoEnrollHandled = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

export const writeAutoEnrollHandled = (key: string) => {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Storage unavailable: the record is lost, so a removed machine may be
    // enrolled again on a later switch. Nothing else depends on it.
  }
};
