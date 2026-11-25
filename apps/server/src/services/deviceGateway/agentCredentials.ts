/**
 * Provider credentials installed on a device for its heterogeneous agent runs
 * (Claude Code, Codex). Server-internal: the install params carry a secret, so
 * these relays never log params and are not reachable from LLM-facing tools.
 */
import type {
  CheckAgentCredentialParams,
  CheckAgentCredentialResult,
  InstallAgentCredentialParams,
  InstallAgentCredentialResult,
  RemoveAgentCredentialParams,
  RemoveAgentCredentialResult,
} from '@lobechat/types';
import debug from 'debug';

import type { DeviceClientGetter } from './types';

const log = debug('lobe-server:device-gateway');

/** Which device the credential RPC addresses. */
export interface AgentCredentialRpcAddress {
  deviceId: string;
  timeout?: number;
  userId: string;
  workspaceId?: string;
}

/**
 * - `unsupported`: the device client cannot hold installed credentials (an
 *   older `lh connect`, or only the desktop app is connected).
 * - `unavailable`: the gateway or the device could not be reached.
 * - `failed`: the device ran the method and it failed (e.g. invalid params).
 */
export type AgentCredentialRpcResult<T> =
  { data: T; status: 'ok' } | { message: string; status: 'failed' | 'unavailable' | 'unsupported' };

const UNSUPPORTED_MARKERS = [
  'does not support installed agent credentials',
  'Unknown device RPC method',
];

const invokeAgentCredentialRpc = async <T>(
  getClient: DeviceClientGetter,
  method: 'checkAgentCredential' | 'installAgentCredential' | 'removeAgentCredential',
  address: AgentCredentialRpcAddress,
  params: unknown,
  defaultTimeout: number,
): Promise<AgentCredentialRpcResult<T>> => {
  const { deviceId, timeout = defaultTimeout, userId, workspaceId } = address;
  const client = getClient();
  if (!client) return { message: 'Device Gateway is not configured', status: 'unavailable' };

  try {
    // Only `lh connect` applies installed credentials to agent runs, so ask
    // for the CLI connection when the device also runs the desktop app.
    const result = await client.invokeRpc<T>(
      { channel: 'cli', deviceId, timeout, userId, workspaceId },
      { method, params },
    );
    if (result.success && result.data !== undefined) return { data: result.data, status: 'ok' };

    // The device scrubs secrets from its errors; params are never logged here.
    const message = result.error || `${method} failed`;
    log('%s: failed for deviceId=%s — %s', method, deviceId, message);
    if (UNSUPPORTED_MARKERS.some((marker) => message.includes(marker))) {
      return { message, status: 'unsupported' };
    }
    return { message, status: result.errorData ? 'unavailable' : 'failed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('%s: error for deviceId=%s — %s', method, deviceId, message);
    return { message, status: 'unavailable' };
  }
};

/** Install (or replace) the provider credential on the device. */
export function installAgentCredential(
  getClient: DeviceClientGetter,
  address: AgentCredentialRpcAddress,
  params: InstallAgentCredentialParams,
) {
  return invokeAgentCredentialRpc<InstallAgentCredentialResult>(
    getClient,
    'installAgentCredential',
    address,
    { provider: params.provider, secret: params.secret },
    15_000,
  );
}

/** Remove the provider credential from the device; removing twice is fine. */
export function removeAgentCredential(
  getClient: DeviceClientGetter,
  address: AgentCredentialRpcAddress,
  params: RemoveAgentCredentialParams,
) {
  return invokeAgentCredentialRpc<RemoveAgentCredentialResult>(
    getClient,
    'removeAgentCredential',
    address,
    { provider: params.provider },
    15_000,
  );
}

/** Ask the device to prove its installed credential works, spending no model quota. */
export function checkAgentCredential(
  getClient: DeviceClientGetter,
  address: AgentCredentialRpcAddress,
  params: CheckAgentCredentialParams,
) {
  return invokeAgentCredentialRpc<CheckAgentCredentialResult>(
    getClient,
    'checkAgentCredential',
    address,
    { provider: params.provider },
    // The device makes one provider call with its own 15s budget.
    30_000,
  );
}
