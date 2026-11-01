import type { ChatToolPayload } from '@lobechat/types';

import type { AgentRuntimeHost, ToolRunExecution } from '../transport';

/** A redelivered step may lag behind its already committed tool result. */
export const resolveToolReplay = async ({
  existingToolMessageId,
  host,
  parentMessageId,
  tool,
}: {
  existingToolMessageId?: string;
  host: AgentRuntimeHost;
  parentMessageId: string;
  tool: ChatToolPayload;
}): Promise<{ execution?: ToolRunExecution; toolMessageId?: string }> => {
  const messages = host.transports.messages;
  const toolMessageId =
    existingToolMessageId ??
    (await messages.findToolMessageIdByToolCallId(tool.id, parentMessageId));
  if (!toolMessageId) return {};

  const message = await messages.getToolMessage(toolMessageId);
  // Do not turn an unreadable result into permission to repeat a side effect.
  if (!message || message.role !== 'tool' || message.tool_call_id !== tool.id) {
    throw new Error(`Cannot read tool result for ${toolMessageId}`);
  }

  const pending =
    message.pluginState?.status === 'pending' || message.pluginIntervention?.status === 'pending';
  const placeholder = !message.content || message.content === '...';
  if (
    pending ||
    (placeholder &&
      !message.pluginError &&
      typeof message.metadata?.toolExecutionTimeMs !== 'number')
  ) {
    return { toolMessageId };
  }

  return {
    execution: {
      attempts: 0,
      result: {
        content: message.content,
        error: message.pluginError,
        executionTime: message.metadata?.toolExecutionTimeMs ?? 0,
        state: message.pluginState,
        stop: message.metadata?.toolResultStop,
        workRegistration: message.metadata?.toolWorkRegistration,
        success:
          message.metadata?.toolResultSuccess ??
          (!message.pluginError &&
            message.pluginState?.type !== 'blocked' &&
            message.pluginIntervention?.status !== 'aborted' &&
            message.pluginIntervention?.status !== 'rejected'),
      },
      resultPersisted: true,
      toolMessageId,
    },
    toolMessageId,
  };
};
