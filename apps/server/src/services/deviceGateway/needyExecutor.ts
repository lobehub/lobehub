/**
 * needy executor runners attached to a device, so a needy actor elsewhere (an
 * agent CLI in a cloud VM) can route the commands it starts to that device.
 * Server-internal: the attach params carry a runner credential, so these
 * relays never log params and are not reachable from LLM-facing tools.
 *
 * TODO(needy-mesh): nothing calls these yet. The session flow that would (an
 * agent's execution targets, the rc Actor that mints the runner credential, the
 * cluster ingress the runner dials) is the design in
 * https://github.com/needy-dev/needy/pull/137 and is not built; wire a caller
 * when that design is accepted.
 */
import {
  type AttachNeedyExecutorParams,
  type AttachNeedyExecutorResult,
  type DetachNeedyExecutorParams,
  type DetachNeedyExecutorResult,
  NEEDY_EXECUTOR_ERROR_PREFIX,
  NEEDY_EXECUTOR_UNSUPPORTED_MESSAGE,
} from '@lobechat/types';
import debug from 'debug';

import type { DeviceClientGetter } from './types';

const log = debug('lobe-server:device-gateway');

/** Which device the needy executor RPC addresses. */
export interface NeedyExecutorRpcAddress {
  deviceId: string;
  timeout?: number;
  userId: string;
  workspaceId?: string;
}

/**
 * - `unsupported`: the device client cannot host a needy executor (the desktop
 *   app, an older `lh`, or a host needy ships no build for).
 * - `unavailable`: the gateway or the device could not be reached, or the
 *   failure did not come from the device's needy handler.
 * - `failed`: the device's handler ran and failed (invalid params, a runner
 *   that exited at once, a download that did not match its digest).
 */
export type NeedyExecutorRpcResult<T> =
  { data: T; status: 'ok' } | { message: string; status: 'failed' | 'unavailable' | 'unsupported' };

const UNSUPPORTED_MARKERS = [NEEDY_EXECUTOR_UNSUPPORTED_MESSAGE, 'Unknown device RPC method'];

const invokeNeedyExecutorRpc = async <T>(
  getClient: DeviceClientGetter,
  method: 'attachNeedyExecutor' | 'detachNeedyExecutor',
  address: NeedyExecutorRpcAddress,
  params: unknown,
  defaultTimeout: number,
): Promise<NeedyExecutorRpcResult<T>> => {
  const { deviceId, timeout = defaultTimeout, userId, workspaceId } = address;
  const client = getClient();
  if (!client) return { message: 'Device Gateway is not configured', status: 'unavailable' };

  try {
    const result = await client.invokeRpc<T>(
      { deviceId, timeout, userId, workspaceId },
      { method, params },
    );
    if (result.success && result.data !== undefined) return { data: result.data, status: 'ok' };

    // The device scrubs the credential from its errors; params are never logged here.
    const message = result.error || `${method} failed`;
    log('%s: failed for deviceId=%s — %s', method, deviceId, message);
    if (UNSUPPORTED_MARKERS.some((marker) => message.includes(marker))) {
      return { message, status: 'unsupported' };
    }
    return {
      message,
      status: message.startsWith(NEEDY_EXECUTOR_ERROR_PREFIX) ? 'failed' : 'unavailable',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('%s: error for deviceId=%s — %s', method, deviceId, message);
    return { message, status: 'unavailable' };
  }
};

/** Start (or reuse) a needy executor runner on the device for one attachment. */
export function attachNeedyExecutor(
  getClient: DeviceClientGetter,
  address: NeedyExecutorRpcAddress,
  params: AttachNeedyExecutorParams,
) {
  return invokeNeedyExecutorRpc<AttachNeedyExecutorResult>(
    getClient,
    'attachNeedyExecutor',
    address,
    {
      address: { host: params.address.host, port: params.address.port },
      attachmentId: params.attachmentId,
      credential: params.credential,
      runnerName: params.runnerName,
      ttlSeconds: params.ttlSeconds,
      version: params.version,
    },
    // A first attach downloads the needy release before the runner starts; the
    // device bounds that download to 150s (`DOWNLOAD_BUDGET_MS` in the CLI), so
    // it fails there before this wait ends rather than starting late.
    180_000,
  );
}

/** Stop the device's runner for one attachment; detaching twice is fine. */
export function detachNeedyExecutor(
  getClient: DeviceClientGetter,
  address: NeedyExecutorRpcAddress,
  params: DetachNeedyExecutorParams,
) {
  return invokeNeedyExecutorRpc<DetachNeedyExecutorResult>(
    getClient,
    'detachNeedyExecutor',
    address,
    { attachmentId: params.attachmentId },
    // The device waits up to 10s for the runner to exit after SIGTERM.
    30_000,
  );
}
