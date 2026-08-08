import { isWorkSkillProvider } from '@lobechat/types';

import { type MCPToolCallResult } from '@/libs/mcp';
import { useToolStore } from '@/store/tool';
import { type ChatToolPayload } from '@/types/message';
import { stashWorkIntent } from '@/utils/clientWorkIntentStash';
import { safeParseJSON } from '@/utils/safeParseJSON';

/**
 * Context for remote tool execution, derived from the invoking message
 */
export interface RemoteToolExecutorContext {
  /** Stable tool call ID */
  sourceToolCallId?: string;
  /** Topic ID from the message that triggered this tool call */
  topicId?: string;
}

/**
 * Executor function type for remote tool invocation
 * @param payload - Tool call payload
 * @param context - Context from the invoking message
 * @returns Promise with MCPToolCallResult data
 */
export type RemoteToolExecutor = (
  payload: ChatToolPayload,
  context?: RemoteToolExecutorContext,
) => Promise<MCPToolCallResult>;

/**
 * Create a failed MCPToolCallResult
 */
const createFailedResult = (
  errorMessage: string,
): { content: string; error: any; state: any; success: false } => ({
  content: errorMessage,
  error: { message: errorMessage },
  state: {},
  success: false,
});

export const composioExecutor: RemoteToolExecutor = async (p, _context) => {
  const identifier = p.identifier;
  const composioServers = useToolStore.getState().composioServers || [];
  const server = composioServers.find((s) => s.identifier === identifier);

  if (!server) {
    return createFailedResult(`Composio server not found: ${identifier}`);
  }

  const args = safeParseJSON(p.arguments) || {};

  const result = await useToolStore.getState().callComposioTool({
    identifier,
    toolArgs: args,
    toolSlug: p.apiName,
  });

  if (!result.success) {
    return createFailedResult(result.error || 'Composio tool execution failed');
  }

  const toolResult = result.data;
  if (toolResult) {
    return {
      content: toolResult.content,
      error: toolResult.state?.isError ? toolResult.state : undefined,
      state: toolResult.state,
      success: toolResult.success,
    };
  }

  return createFailedResult('Composio tool returned empty result');
};

export const lobehubSkillExecutor: RemoteToolExecutor = async (p, context) => {
  // payload.identifier is the provider id (e.g., 'linear', 'microsoft')
  const provider = p.identifier;

  // Parse arguments
  const args = safeParseJSON(p.arguments) || {};

  // Call LobeHub Skill tool via store action
  // topicId comes from message context, not global active state
  const result = await useToolStore.getState().callLobehubSkillTool({
    args,
    provider,
    toolName: p.apiName,
    topicId: context?.topicId,
  });

  if (!result.success) {
    return createFailedResult(
      result.error || `LobeHub Skill tool ${provider} ${p.apiName} execution failed`,
    );
  }

  if (isWorkSkillProvider(provider)) {
    // Stash the Work-registration intent (carrying the UNTRUNCATED result data)
    // keyed by toolCallId; `call_tool` drains it and registers the Work ONCE the
    // tool call's cumulative cost is known, instead of registering cost-less here
    // and back-filling. The runtime supplies provenance + cost at persist time.
    stashWorkIntent(context?.sourceToolCallId, {
      args,
      data: result.data,
      provider,
      toolName: p.apiName,
      type: 'skill',
    });
  }

  // Convert to MCPToolCallResult format
  const content = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);

  return {
    content,
    error: undefined,
    state: { content: [{ text: content, type: 'text' }] },
    success: true,
  };
};
