import type { ChatToolPayloadWithResult, ToolIntervention, UIChatMessage } from '@lobechat/types';

export interface PendingIntervention {
  apiName: string;
  assistantGroupId?: string;
  identifier: string;
  intervention: ToolIntervention & { status: 'pending' };
  requestArgs: string;
  toolCallId: string;
  toolMessageId: string;
}

export const getPendingInterventions = (
  displayMessages: UIChatMessage[],
): PendingIntervention[] => {
  const pending: PendingIntervention[] = [];

  for (const msg of displayMessages) {
    // Standalone tool messages with pluginIntervention pending
    if (
      msg.role === 'tool' &&
      msg.pluginIntervention?.status === 'pending' &&
      msg.plugin &&
      !msg.id.startsWith('tmp_')
    ) {
      pending.push({
        apiName: msg.plugin.apiName,
        identifier: msg.plugin.identifier,
        intervention: msg.pluginIntervention as ToolIntervention & { status: 'pending' },
        requestArgs: msg.plugin.arguments || '',
        toolCallId: msg.tool_call_id || msg.id,
        toolMessageId: msg.id,
      });
    }

    // Messages with children blocks containing tools (assistantGroup, assistant, etc.)
    if (msg.children) {
      for (const block of msg.children) {
        if (!block.tools) continue;
        collectPendingTools(block.tools, pending, msg.id);
      }
    }
  }

  return pending;
};

const collectPendingTools = (
  tools: ChatToolPayloadWithResult[],
  pending: PendingIntervention[],
  assistantGroupId?: string,
) => {
  for (const tool of tools) {
    if (
      tool.intervention?.status === 'pending' &&
      tool.result_msg_id &&
      !tool.result_msg_id.startsWith('tmp_')
    ) {
      pending.push({
        apiName: tool.apiName,
        assistantGroupId,
        identifier: tool.identifier,
        intervention: tool.intervention as ToolIntervention & { status: 'pending' },
        requestArgs: tool.arguments || '',
        toolCallId: tool.id,
        toolMessageId: tool.result_msg_id,
      });
    }
  }
};
