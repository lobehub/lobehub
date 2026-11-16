import { type MCPToolCallResult } from '@/libs/mcp';
import { getMcpAppFromState } from '@/libs/mcp/mcpApp';
import { mcpService } from '@/services/mcp';
import { mcpAppActions } from '@/store/mcpApp/action';

import { getAppToolCallPolicy } from './toolCallPolicy';

export interface McpAppEntrypointCall {
  agentId?: string;
  /** The tab instance: one per topic and entrypoint. */
  id: string;
  identifier: string;
  /** The account to open as, on a connector holding several. */
  linkId?: string;
  toolName: string;
  /**
   * The conversation the app opens in. A private connector resolves only in
   * its owner's private-agent topic, so the approval and the call need it to
   * reach the row the open menu listed.
   */
  topicId?: string;
}

/** Call an entrypoint's tool with `{}`, as MCP Apps opens one, and require a view in the result. */
export const callMcpAppEntrypoint = async ({
  agentId,
  id,
  identifier,
  linkId,
  toolName,
  topicId,
}: McpAppEntrypointCall): Promise<MCPToolCallResult> => {
  // Entrypoints ignore `_meta.ui.visibility`; the agent's tool rules still apply
  const policy = await getAppToolCallPolicy(identifier, toolName, {
    agentId,
    fromEntrypoint: true,
    topicId,
  });
  if (policy === 'deny') throw new Error('This tool is unavailable');

  const response = await mcpService.invokeMcpToolCall(
    { apiName: toolName, arguments: '{}', id, identifier, type: 'mcp' },
    { agentId, fromEntrypoint: true, linkId, topicId },
  );
  if (!response?.success || !getMcpAppFromState(response.state)) {
    throw new Error('The entrypoint returned no app view');
  }

  return response;
};

/**
 * Open an entrypoint tab's app: a tool call the user asked for (choosing the
 * app, or Retry), never one a render or a remount starts. The tab's state
 * holds the result; a later open supersedes an earlier one still running.
 */
export const openMcpAppEntrypoint = async (call: McpAppEntrypointCall) => {
  const request = mcpAppActions.startEntry(call.id);
  if (!request) return;
  try {
    mcpAppActions.settleEntry(call.id, request, await callMcpAppEntrypoint(call));
  } catch {
    mcpAppActions.settleEntry(call.id, request);
  }
};
