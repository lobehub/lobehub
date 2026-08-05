import type { ChatToolPayloadWithResult, ToolIntervention, UIChatMessage } from '@lobechat/types';

export interface PendingIntervention {
  apiName: string;
  /**
   * Id of the assistant turn that emitted this tool call.
   *
   * The list itself spans the WHOLE conversation, so any consumer that wants to
   * act on "this parallel batch" (e.g. approve-all) must group by this field
   * first — two pending calls can belong to different turns, and resolving them
   * together would execute them under one anchor with unrelated results.
   * `undefined` means the owner could not be determined; treat such an entry as
   * its own group rather than folding it in with the others.
   */
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
        // A standalone tool row parents directly to its calling assistant.
        assistantGroupId: msg.parentId,
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

/**
 * Narrow a whole-conversation pending list down to ONE parallel batch — the
 * calls emitted by the same assistant turn as `active`.
 *
 * `getPendingInterventions` walks every message, so its length says nothing
 * about batch membership: an abandoned approval from an earlier turn sits in
 * the same list as this turn's calls. Any bulk action must group first —
 * resolving across turns hands the server a set it executes under one assistant
 * anchor and continues the model once with unrelated results, running a tool the
 * user never meant to release into this turn.
 *
 * An entry whose owner cannot be resolved is its own batch: unknown owners must
 * not collapse into one pseudo-group.
 */
export const getInterventionBatch = (
  interventions: PendingIntervention[],
  active: PendingIntervention | undefined,
): PendingIntervention[] => {
  if (!active) return [];
  const owner = active.assistantGroupId;
  if (!owner) return [active];
  return interventions.filter((i) => i.assistantGroupId === owner);
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
