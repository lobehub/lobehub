import { useEffect } from 'react';

import { type MCPToolCallResult } from '@/libs/mcp';
import { getMcpAppFromState } from '@/libs/mcp/mcpApp';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { mcpAppKeys } from '@/libs/swr/keys';
import { mcpService } from '@/services/mcp';

import { getAppToolCallPolicy } from './toolCallPolicy';

interface McpAppEntrypointParams {
  agentId?: string;
  /** The tab instance: one per topic and entrypoint. */
  id: string;
  identifier?: string;
  toolName?: string;
}

/** Call an entrypoint's tool with `{}`, as MCP Apps opens one, and require a view in the result. */
export const openMcpAppEntrypoint = async ({
  agentId,
  id,
  identifier,
  toolName,
}: Required<Pick<McpAppEntrypointParams, 'id' | 'identifier' | 'toolName'>> &
  Pick<McpAppEntrypointParams, 'agentId'>): Promise<MCPToolCallResult> => {
  // Entrypoints ignore `_meta.ui.visibility`; the agent's tool rules still apply
  const policy = await getAppToolCallPolicy(identifier, toolName, {
    agentId,
    fromEntrypoint: true,
  });
  if (policy === 'deny') throw new Error('This tool is unavailable');

  const response = await mcpService.invokeMcpToolCall(
    { apiName: toolName, arguments: '{}', id, identifier, type: 'mcp' },
    { agentId, fromEntrypoint: true },
  );
  if (!response?.success || !getMcpAppFromState(response.state)) {
    throw new Error('The entrypoint returned no app view');
  }

  return response;
};

/**
 * The result an open entrypoint tab renders. Opening is a tool call, so it
 * never re-runs on its own (focus, reconnect, error retry): only `mutate()`,
 * the retry button, runs it again. Each mount opens the app afresh, as MCP
 * Apps hosts do: the cached result is dropped when the tab unmounts, so
 * closing and reopening the tab, or coming back to its topic, calls the tool
 * again instead of showing the previous instance's data.
 */
export const useFetchMcpAppEntrypoint = ({
  agentId,
  id,
  identifier,
  toolName,
}: McpAppEntrypointParams) => {
  const enabled = !!identifier && !!toolName;

  useEffect(() => {
    if (!enabled) return;
    return () => {
      void mutate(mcpAppKeys.entrypoint(id, agentId), undefined, { revalidate: false });
    };
  }, [agentId, enabled, id]);

  return useClientDataSWR<MCPToolCallResult>(
    enabled ? mcpAppKeys.entrypoint(id, agentId) : null,
    () => openMcpAppEntrypoint({ agentId, id, identifier: identifier!, toolName: toolName! }),
    {
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );
};
