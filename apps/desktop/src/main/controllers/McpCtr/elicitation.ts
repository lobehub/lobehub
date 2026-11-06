import type { McpElicitationHost } from '@lobechat/mcp-elicitation';
import { mcpInvocationKey } from '@lobechat/mcp-elicitation/transport';
import type { McpElicitationCall } from '@lobechat/mcp-elicitation/types';
import { toRecord } from '@lobechat/utils/object';
import type { ElicitResult } from '@modelcontextprotocol/client';

import { createLogger } from '@/utils/logger';

import type { McpCompletionDelivery } from '../mcpCompletionDelivery';
import type { McpInvocationRegistry } from '../mcpInvocation';
import type RemoteServerConfigCtr from '../RemoteServerConfigCtr';

const logger = createLogger('controllers:McpCtr');
type NativeMcpConfig = Pick<
  RemoteServerConfigCtr,
  'getRemoteServerUrl' | 'getAccessToken' | 'getDesktopBootstrapIdentity'
>;
interface NativeMcpResult {
  content: string;
  state: unknown;
  success: boolean;
}
interface NativeMcpOwner {
  serverUrl: string;
  userId: string;
}

export async function relayNativeMcpResult(
  config: NativeMcpConfig,
  elicitation: McpElicitationCall | undefined,
  result: NativeMcpResult,
  owner: NativeMcpOwner,
  resolveDeviceId: () => Promise<string | undefined>,
) {
  if (!elicitation?.relayResult) return true;
  const [serverUrl, token] = await Promise.all([
    config.getRemoteServerUrl(),
    config.getAccessToken(),
  ]);
  if (!serverUrl || !token) throw new Error('MCP completion has no authenticated server');
  if (
    (await config.getRemoteServerUrl()) !== owner.serverUrl ||
    config.getDesktopBootstrapIdentity().userId !== owner.userId
  )
    return false;
  // This callback outlives the renderer's markLocalView. Stamp the same local
  // identity here, before the receipt is published, without mutating the tool result.
  const state = toRecord(result.state);
  const view = toRecord(state?.mcpApp);
  if (state && view) {
    const deviceId = await resolveDeviceId();
    const { mcpApp: _view, ...rest } = state;
    result = {
      ...result,
      state: { ...rest, ...(deviceId && { mcpApp: { ...view, deviceId } }) },
    };
  }
  const response = await fetch(`${serverUrl}/trpc/lambda/mcpElicitation.producerResult`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Oidc-Auth': token,
      ...(elicitation.workspaceId && { 'X-Workspace-Id': elicitation.workspaceId }),
    },
    body: JSON.stringify({
      json: { identity: elicitation.identity, delegation: elicitation.delegation, result },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408 &&
      response.status !== 429
    ) {
      logger.warn(`MCP completion authorization ended: HTTP ${response.status}`);
      return false;
    }
    throw new Error(`MCP completion relay failed: HTTP ${response.status}`);
  }
  return true;
}

/** Uses controller-owned invocation and delivery registries, never module-global state. */
export async function runNativeMcpElicitation({
  config,
  elicitation,
  fingerprint,
  producerId,
  invocations,
  completions,
  execute,
  relay,
}: {
  config: NativeMcpConfig;
  elicitation: McpElicitationCall;
  fingerprint: string;
  producerId: string;
  invocations: McpInvocationRegistry;
  completions: McpCompletionDelivery;
  execute: (owner: NativeMcpOwner) => Promise<NativeMcpResult>;
  relay: (result: NativeMcpResult, owner: NativeMcpOwner) => Promise<boolean>;
}) {
  const userId = config.getDesktopBootstrapIdentity().userId;
  if (!userId) throw new Error('MCP elicitation requires an authenticated user');
  const serverUrl = await config.getRemoteServerUrl();
  if (!serverUrl) throw new Error('MCP invocation has no server');
  const owner = { userId, serverUrl };
  const token = await config.getAccessToken();
  if (!token) throw new Error('MCP invocation has no authenticated server');
  if (
    (await config.getRemoteServerUrl()) !== owner.serverUrl ||
    config.getDesktopBootstrapIdentity().userId !== owner.userId
  )
    throw new Error('MCP producer login changed');
  const response = await fetch(`${serverUrl}/trpc/lambda/mcpElicitation.beginProducer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Oidc-Auth': token,
      ...(elicitation.workspaceId && { 'X-Workspace-Id': elicitation.workspaceId }),
    },
    body: JSON.stringify({
      json: {
        identity: elicitation.identity,
        delegation: elicitation.delegation,
        deadline: elicitation.deadline,
        fingerprint,
        producerId,
      },
    }),
    signal: AbortSignal.timeout(Math.max(1, Math.min(15000, elicitation.deadline - Date.now()))),
  });
  const body = (await response.json()) as {
    result?: { data?: { json?: { claimed?: boolean; initiatorUserId?: string } } };
  };
  if (!response.ok || !body.result?.data?.json?.claimed || !body.result.data.json.initiatorUserId)
    throw new Error(
      'The original MCP invocation is already owned by another producer. Its outcome is unknown; it was not repeated.',
    );
  const initiatorUserId = body.result.data.json.initiatorUserId;
  const key = JSON.stringify([
    serverUrl,
    mcpInvocationKey({
      ...elicitation.identity,
      userId: initiatorUserId,
      workspaceId: elicitation.workspaceId,
    }),
  ]);
  const deliver = (result: { content: string; state: unknown; success: boolean }) => {
    if (!elicitation.relayResult) return;
    void completions
      .deliver(key, elicitation.deadline + 60_000, () => relay(result, owner))
      .catch((error) => logger.warn('MCP completion delivery stopped', error));
  };
  const result = await invocations.run(key, fingerprint, elicitation.deadline, async () => {
    try {
      return await execute(owner);
    } catch (error) {
      deliver({
        content: error instanceof Error ? error.message : 'MCP tool failed',
        success: false,
        state: {},
      });
      throw error;
    }
  });
  deliver(result);
  return result;
}

export function createNativeMcpElicitationHost(
  config: NativeMcpConfig,
  elicitation: McpElicitationCall | undefined,
  owner?: NativeMcpOwner,
): McpElicitationHost | undefined {
  return elicitation
    ? {
        request: async (request, { signal, checkpoint }) => {
          const [serverUrl, token] = await Promise.all([
            config.getRemoteServerUrl(),
            config.getAccessToken(),
          ]);
          if (!serverUrl || !token)
            throw new Error('MCP elicitation requires an authenticated LobeHub server');
          if (
            owner &&
            (serverUrl !== owner.serverUrl ||
              config.getDesktopBootstrapIdentity().userId !== owner.userId)
          )
            throw new Error('MCP producer login changed');
          const response = await fetch(`${serverUrl}/trpc/lambda/mcpElicitation.legacyRequest`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Oidc-Auth': token,
              ...(elicitation.workspaceId && {
                'X-Workspace-Id': elicitation.workspaceId,
              }),
            },
            body: JSON.stringify({
              json: {
                identity: elicitation.identity,
                delegation: elicitation.delegation,
                request,
                checkpoint,
                deadline: elicitation.deadline,
              },
            }),
            signal,
          });
          const body = (await response.json()) as {
            error?: unknown;
            result?: { data?: { json?: ElicitResult } };
          };
          if (!response.ok || !body.result?.data?.json)
            throw new Error('MCP elicitation could not be delivered to this conversation');
          return body.result.data.json;
        },
      }
    : undefined;
}
