import type { ChatToolPayload } from '@lobechat/types';

export const isFoldedAssistantGroup = (message: any): boolean => {
  return (
    (message?.role === 'assistantGroup' || message?.role === 'supervisor') &&
    (message.children ?? []).some((child: any) => child.tools?.length > 0)
  );
};

/**
 * Normalize an `assistantGroup`'s folded tool entries back into the tool-row
 * shape the rest of the runner expects (`plugin`, `pluginIntervention`,
 * `parentId`), keeping only the pending ones.
 */
export const pendingToolMessagesFromGroup = (group: any): any[] => {
  return (group.children ?? [])
    .flatMap((child: any) => child.tools ?? [])
    .filter((tool: any) => tool.intervention?.status === 'pending')
    .map((tool: any) => {
      // Drop the display-only fields FlatListBuilder merges onto the entry so
      // `plugin` is a plain ChatToolPayload — the same shape the raw path
      // produces, and what `request_human_approve` / `call_tool` expect.
      const { intervention, result: _result, result_msg_id, ...plugin } = tool;
      return {
        id: result_msg_id,
        parentId: group.id,
        plugin: plugin as ChatToolPayload,
        pluginIntervention: intervention,
        role: 'tool',
        tool_call_id: tool.id,
      };
    });
};

/**
 * Pending-tool scope guard for the main loop.
 *
 * The pending-approval check must only count tool messages produced by the
 * **current** assistant turn. Stale `pluginIntervention.status === 'pending'`
 * rows from a previous turn (e.g. an abandoned approval flow whose user
 * never clicked approve/reject) get loaded back into `state.messages` via
 * `historyMessages` and would otherwise hijack every subsequent
 * `tool_result` / `tools_batch_result` phase, parking the loop in
 * `waiting_for_human` forever.
 *
 * "Current turn" = the most recent assistant message that emitted tool calls,
 * stored as either model-native `tool_calls` or persisted `tools`. All pending
 * tool messages legitimately belonging to this turn have
 * `parentId === currentAssistantId`.
 *
 * Two message shapes reach this method and BOTH must be handled:
 *
 * 1. **Raw shape** (client runtime, and any step that never round-tripped
 *    through the DB): a `role: 'assistant'` row carrying `tools` /
 *    `tool_calls`, followed by sibling `role: 'tool'` rows whose
 *    `pluginIntervention.status` is the approval state.
 * 2. **Parsed shape** (server runtime): `AgentRuntimeService` rebuilds
 *    `state.messages` from the DB through `conversation-flow`'s `parse()` on
 *    every step entry, and `FlatListBuilder` folds an assistant plus its tool
 *    rows into ONE `role: 'assistantGroup'` virtual message. In that shape
 *    there is no `role: 'assistant'` row carrying tools and no top-level
 *    `role: 'tool'` row at all — the tool calls live in
 *    `children[].tools[]`, each carrying `intervention` and `result_msg_id`.
 *
 * Matching only shape 1 made this guard a no-op on the entire server runtime:
 * approving one tool of a parallel batch resumed the LLM immediately while the
 * other N-1 tool rows were still `pending` with empty content, so the model
 * saw blank tool results and (visibly, in reproduction) re-issued the whole
 * batch. Every parallel-approval defect downstream of that — forked parent
 * chains, duplicate batches — starts here.
 */
export const findCurrentTurnPendingToolMessages = (stateMessages: unknown[] | undefined): any[] => {
  const messages = (stateMessages ?? []) as any[];

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];

    // Shape 2 — parsed `assistantGroup`. Read the folded tool entries; their
    // `result_msg_id` is the tool message id the approval flow addresses.
    if (isFoldedAssistantGroup(m)) {
      return pendingToolMessagesFromGroup(m);
    }

    // Shape 1 — raw assistant + sibling tool rows.
    if (m.role === 'assistant' && (m.tool_calls?.length > 0 || m.tools?.length > 0)) {
      return messages.filter(
        (t: any) =>
          t.role === 'tool' && t.pluginIntervention?.status === 'pending' && t.parentId === m.id,
      );
    }
  }

  return [];
};
