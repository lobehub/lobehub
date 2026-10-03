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

/**
 * Envelope returned by CLI-based LobeHub Skill providers (e.g. GitHub's `gh`
 * CLI, and any future provider built on the shared cli-base infra) after
 * running a command.
 */
interface CLISkillCommandResult {
  command: string;
  exitCode: number;
  output: string;
}

const isCLISkillCommandResult = (data: unknown): data is CLISkillCommandResult =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as CLISkillCommandResult).command === 'string' &&
  typeof (data as CLISkillCommandResult).exitCode === 'number' &&
  typeof (data as CLISkillCommandResult).output === 'string';

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

  // Convert to MCPToolCallResult format.
  // CLI-based skill providers (e.g. `gh`) wrap a successful command's stdout in a
  // { command, exitCode, output } envelope. On success, surface `output` directly
  // instead of JSON-stringifying the whole envelope — the escaped result is unreadable
  // in the chat transcript, and command/exitCode add no value once it already succeeded.
  // A non-zero exitCode still falls through to the full envelope so the model can see
  // command/exitCode/stderr and self-correct.
  const content =
    typeof result.data === 'string'
      ? result.data
      : isCLISkillCommandResult(result.data) && result.data.exitCode === 0
        ? result.data.output
        : JSON.stringify(result.data);

  return {
    content,
    error: undefined,
    state: { content: [{ text: content, type: 'text' }] },
    success: true,
  };
};
