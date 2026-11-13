/**
 * Interactive terminal (PTY) RPCs, relayed to the device client hosting the
 * shell — `lh connect` or the desktop app.
 */
import type {
  DeviceClient,
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

/**
 * Scope of a call on an existing session. `client` is what `createTerminalSession`
 * answered with: each client keeps its own sessions, so on a device holding
 * both connections the call has to reach the one that created the shell.
 */
interface TerminalSessionRpcScope extends TerminalRpcScope {
  client?: DeviceClient;
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
  params: TerminalSessionRpcScope & { data: string; id: string },
): Promise<void> {
  await invokeTerminalRpc(getClient, 'writeTerminal', params, { data: params.data, id: params.id });
}

export async function readTerminal(
  getClient: DeviceClientGetter,
  params: TerminalSessionRpcScope & { cursor: number; id: string },
): Promise<DeviceReadTerminalResult> {
  return invokeTerminalRpc(getClient, 'readTerminal', params, {
    cursor: params.cursor,
    id: params.id,
  });
}

export async function resizeTerminal(
  getClient: DeviceClientGetter,
  params: TerminalSessionRpcScope & { cols: number; id: string; rows: number },
): Promise<void> {
  await invokeTerminalRpc(getClient, 'resizeTerminal', params, {
    cols: params.cols,
    id: params.id,
    rows: params.rows,
  });
}

export async function closeTerminal(
  getClient: DeviceClientGetter,
  params: TerminalSessionRpcScope & { id: string },
): Promise<DeviceCloseTerminalResult> {
  return invokeTerminalRpc(getClient, 'closeTerminal', params, { id: params.id });
}

/**
 * Relay one terminal RPC and unwrap its result.
 *
 * Opening a shell carries the `cli` channel hint, so a device running both
 * `lh connect` and the desktop app hosts it in the daemon. Calls on an existing
 * session are restricted (`clientKinds`) to the client that created it — the
 * two keep separate sessions, so letting the gateway re-pick per call would
 * send a desktop session's reads to the CLI as soon as `lh connect` comes up.
 * A gateway that predates either field ignores it, which is why a refusal
 * still has to surface as an error.
 */
export async function invokeTerminalRpc<T>(
  getClient: DeviceClientGetter,
  method: TerminalRpcMethod,
  params: TerminalSessionRpcScope,
  rpcParams: Record<string, unknown>,
): Promise<T> {
  const { client: sessionClient, deviceId, timeout = 15_000, userId, workspaceId } = params;
  const client = getClient();
  if (!client) throw new Error('Device gateway is not configured on this deployment.');

  const result = await client.invokeRpc<T>(
    {
      channel: 'cli',
      ...(sessionClient ? { clientKinds: [sessionClient] } : {}),
      deviceId,
      timeout,
      userId,
      workspaceId,
    },
    { method, params: rpcParams },
  );
  // `writeTerminal` / `resizeTerminal` answer with no payload, so absence of
  // `data` is not a failure — only an explicit `success: false` is.
  if (!result.success) throw new Error(result.error || `${method} failed`);
  return result.data as T;
}
