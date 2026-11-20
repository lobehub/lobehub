import { setDesktopUserAgentHeader } from '@/utils/user-agent';

/**
 * The authed server calls the gateway connection makes on this device's
 * behalf, over the desktop's own OIDC token (the device has no tRPC client).
 */

interface ServerAuth {
  serverUrl: string;
  token: string;
}

const authedHeaders = (token: string, workspaceId?: string): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Oidc-Auth': token,
  };
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  setDesktopUserAgentHeader(headers);
  return headers;
};

export interface AgentNotifyParams {
  agentId?: string;
  cancelled?: boolean;
  content: string;
  done?: boolean;
  error?: { message: string; type?: string };
  operationId?: string;
  role: string;
  topicId: string;
  /**
   * Workspace scope for the notify. When set, attaches `X-Workspace-Id` so
   * agentNotify resolves the workspace-owned topic instead of falling back
   * to personal mode (which would 404 the lookup).
   */
  workspaceId?: string;
}

/** Relay agent output or a completion signal through `agentNotify.notify`. */
export const postAgentNotify = async (
  { workspaceId, ...body }: AgentNotifyParams,
  { serverUrl, token }: ServerAuth,
): Promise<void> => {
  await fetch(`${serverUrl}/trpc/lambda/agentNotify.notify`, {
    body: JSON.stringify({ json: body }),
    headers: authedHeaders(token, workspaceId),
    method: 'POST',
  });
};

/**
 * Persist this device to the server registry via `device.register`.
 * Fire-and-forget from the connect path: a failure must not block the WS
 * connection, the device just won't appear in the offline list until the
 * next successful connect.
 */
export const postDeviceRegistration = async (
  info: { deviceId: string; hostname: string; identitySource: string; platform: string },
  { serverUrl, token }: ServerAuth,
): Promise<void> => {
  await fetch(`${serverUrl}/trpc/lambda/device.register`, {
    body: JSON.stringify({ json: info }),
    headers: authedHeaders(token),
    method: 'POST',
  });
};

/**
 * Ask the server to run the worktree cleanups waiting on this device. It
 * calls back over the gateway (`cleanupOwnedWorktree`) after answering, so
 * this returns at once.
 */
export const requestWorktreeCleanupDrain = async (
  { deviceId, workspaceId }: { deviceId: string; workspaceId?: string },
  { serverUrl, token }: ServerAuth,
): Promise<void> => {
  const response = await fetch(`${serverUrl}/trpc/lambda/device.drainWorktreeCleanups`, {
    body: JSON.stringify({ json: { deviceId } }),
    // A share connection's cleanups live in its workspace.
    headers: authedHeaders(token, workspaceId),
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Worktree cleanup drain failed: HTTP ${response.status}`);
};
