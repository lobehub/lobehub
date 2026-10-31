/**
 * Interactive terminal (PTY) RPCs, relayed to the `lh connect` process.
 */
import type {
  DeviceCloseTerminalResult,
  DeviceCreateTerminalSessionResult,
  DeviceReadTerminalResult,
} from '@lobechat/types';

import type { DeviceClientGetter } from './types';

/** Scope every terminal RPC carries; mirrors `AppUpdateRpcParams`. */
interface TerminalRpcScope {
  deviceId: string;
  timeout?: number;
  userId: string;
  workspaceId?: string;
}

/** The five device RPCs that make up one interactive terminal session. */
type TerminalRpcMethod =
  'closeTerminal' | 'createTerminalSession' | 'readTerminal' | 'resizeTerminal' | 'writeTerminal';

// A terminal is a session the caller drives, not a one-shot read, so these
// deliberately THROW on failure instead of returning `undefined` the way the
// best-effort readers do: the panel has to say why a shell did not open
// (device offline, a client without PTY support) rather than wait forever on
// one that will never exist.

export async function createTerminalSession(
  getClient: DeviceClientGetter,
  params: TerminalRpcScope & { cols: number; cwd?: string; rows: number },
): Promise<DeviceCreateTerminalSessionResult> {
  return invokeTerminalRpc(getClient, 'createTerminalSession', params, {
    cols: params.cols,
    cwd: params.cwd,
    rows: params.rows,
  });
}

export async function writeTerminal(
  getClient: DeviceClientGetter,
  params: TerminalRpcScope & { data: string; id: string },
): Promise<void> {
  await invokeTerminalRpc(getClient, 'writeTerminal', params, { data: params.data, id: params.id });
}

export async function readTerminal(
  getClient: DeviceClientGetter,
  params: TerminalRpcScope & { cursor: number; id: string },
): Promise<DeviceReadTerminalResult> {
  return invokeTerminalRpc(getClient, 'readTerminal', params, {
    cursor: params.cursor,
    id: params.id,
  });
}

export async function resizeTerminal(
  getClient: DeviceClientGetter,
  params: TerminalRpcScope & { cols: number; id: string; rows: number },
): Promise<void> {
  await invokeTerminalRpc(getClient, 'resizeTerminal', params, {
    cols: params.cols,
    id: params.id,
    rows: params.rows,
  });
}

export async function closeTerminal(
  getClient: DeviceClientGetter,
  params: TerminalRpcScope & { id: string },
): Promise<DeviceCloseTerminalResult> {
  return invokeTerminalRpc(getClient, 'closeTerminal', params, { id: params.id });
}

/**
 * Relay one terminal RPC and unwrap its result.
 *
 * Every call carries the `cli` channel hint: the PTY lives in the `lh
 * connect` process, so on a machine also running the desktop app the RPC has
 * to reach that connection — the desktop's own terminal is local-only and
 * would refuse these. A gateway that predates the hint ignores it, which is
 * why the refusal below still has to surface as an error.
 */
export async function invokeTerminalRpc<T>(
  getClient: DeviceClientGetter,
  method: TerminalRpcMethod,
  params: TerminalRpcScope,
  rpcParams: Record<string, unknown>,
): Promise<T> {
  const { deviceId, timeout = 15_000, userId, workspaceId } = params;
  const client = getClient();
  if (!client) throw new Error('Device gateway is not configured on this deployment.');

  const result = await client.invokeRpc<T>(
    { channel: 'cli', deviceId, timeout, userId, workspaceId },
    { method, params: rpcParams },
  );
  // `writeTerminal` / `resizeTerminal` answer with no payload, so absence of
  // `data` is not a failure — only an explicit `success: false` is.
  if (!result.success) throw new Error(result.error || `${method} failed`);
  return result.data as T;
}
