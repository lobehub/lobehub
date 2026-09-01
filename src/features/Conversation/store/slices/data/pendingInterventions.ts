import {
  type ChatToolPayloadWithResult,
  classifyToolInterventionPresentation,
  type ToolIntervention,
  type UIChatMessage,
} from '@lobechat/types';

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
  batchId?: string;
  identifier: string;
  intervention: ToolIntervention & { status: 'pending' };
  operationId?: string;
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
        batchId: msg.pluginIntervention.batchId,
        identifier: msg.plugin.identifier,
        intervention: msg.pluginIntervention as ToolIntervention & { status: 'pending' },
        operationId: msg.pluginIntervention.operationId,
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

  if (active.operationId && active.batchId) {
    return interventions.filter(
      (item) => item.operationId === active.operationId && item.batchId === active.batchId,
    );
  }

  // A partially stamped row is neither a trustworthy durable identity nor a
  // legacy row. Keep it isolated so a rollout mismatch cannot broaden a bulk
  // action to cards the server will reject as a different sealed batch.
  if (active.operationId || active.batchId) return [active];

  const owner = active.assistantGroupId;
  if (!owner) return [active];
  return interventions.filter(
    (item) => !item.operationId && !item.batchId && item.assistantGroupId === owner,
  );
};

/**
 * Approve-all is meaningful only for a fully binary same-turn batch. AskUser,
 * marketplace, provider forms, and mixed batches each carry action-specific
 * payloads and must be resolved card by card.
 */
export const canApproveInterventionBatch = (batch: PendingIntervention[]): boolean => {
  if (batch.length <= 1) return false;

  const hasDurableMember = batch.some(({ batchId, operationId }) => batchId || operationId);
  if (
    hasDurableMember &&
    !batch.every(
      ({ batchId, operationId }) =>
        Boolean(batchId) &&
        Boolean(operationId) &&
        batchId === batch[0].batchId &&
        operationId === batch[0].operationId,
    )
  ) {
    return false;
  }

  return batch.every(
    ({ apiName, identifier }) =>
      classifyToolInterventionPresentation(identifier, apiName).surface === 'binary',
  );
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
        batchId: tool.intervention.batchId,
        identifier: tool.identifier,
        intervention: tool.intervention as ToolIntervention & { status: 'pending' },
        operationId: tool.intervention.operationId,
        requestArgs: tool.arguments || '',
        toolCallId: tool.id,
        toolMessageId: tool.result_msg_id,
      });
    }
  }
};
