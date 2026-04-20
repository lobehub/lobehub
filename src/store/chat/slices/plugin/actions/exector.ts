import { type MCPToolCallResult } from '@/libs/mcp';
import { truncateToolResult } from '@/server/utils/truncateToolResult';
import { useToolStore } from '@/store/tool';
import { type ChatToolPayload } from '@/types/message';
import { safeParseJSON } from '@/utils/safeParseJSON';

/**
 * Context for remote tool execution, derived from the invoking message
 */
export interface RemoteToolExecutorContext {
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

export const klavisExecutor: RemoteToolExecutor = async (p, _context) => {
  // payload.identifier is now the storage identifier (e.g., 'google-calendar')
  const identifier = p.identifier;
  const klavisServers = useToolStore.getState().servers || [];
  const server = klavisServers.find((s) => s.identifier === identifier);

  if (!server) {
    return createFailedResult(`Klavis server not found: ${identifier}`);
  }

  // Parse arguments
  const args = safeParseJSON(p.arguments) || {};

  // Call Klavis tool via store action
  const result = await useToolStore.getState().callKlavisTool({
    serverUrl: server.serverUrl,
    toolArgs: args,
    toolName: p.apiName,
  });

  if (!result.success) {
    return createFailedResult(result.error || 'Klavis tool execution failed');
  }

  // result.data is MCPToolCallProcessedResult from server
  // Convert to MCPToolCallResult format
  const toolResult = result.data;
  if (toolResult) {
    return {
      content: truncateToolResult(toolResult.content),
      error: toolResult.state?.isError ? toolResult.state : undefined,
      state: toolResult.state,
      success: toolResult.success,
    };
  }

  return createFailedResult('Klavis tool returned empty result');
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

  // Convert to MCPToolCallResult format
  const rawContent = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
  const content = truncateToolResult(rawContent);

  return {
    content,
    error: undefined,
    state: { content: [{ text: content, type: 'text' }] },
    success: true,
  };
};
