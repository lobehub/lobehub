import type { ChatToolPayload, UIChatMessage } from '@lobechat/types';

/**
 * Keep a raw message bucket internally consistent on the tool↔assistant link.
 *
 * Invariant: every present `role:'tool'` message whose `parentId` resolves to an
 * assistant in the SAME bucket must be referenced by that assistant's `tools[]`
 * (matching `tool_call_id`). conversation-flow groups a tool into its assistant
 * SOLELY via `assistant.tools[].id` (parentId only finds the next assistant), so
 * the moment an assistant's `tools[]` loses an entry whose tool row is still
 * present, that tool falls through to a top-level `role:'tool'` bubble — the
 * orphan the UI flags as `inspector.orphanedToolCall`.
 *
 * This is reachable during hetero-agent (Claude Code) streaming: a fast tool's
 * `tool_result` + the next step's `message_start` cluster in a tiny window, so
 * `replaceMessages` (stale / out-of-order DB snapshot) or an optimistic
 * `internal_dispatchMessage updateMessage{tools}` can momentarily drop an
 * assistant's `tools[]` while the tool row + parentId survive (the extreme of
 * the "7→6 tool-calls" tools[] regression).
 *
 * Fixing this at the RAW bucket write boundary — not only inside `parse` — keeps
 * `dbMessagesMap` (the Source of Truth that optimistic updates read & mutate)
 * consistent, so every downstream consumer (display parse, next optimistic
 * dispatch, model context) sees the tool bound to its owner.
 *
 * Safe by construction:
 * - Only re-links tool rows that ARE present, so a genuine deletion (row gone)
 *   is never resurrected.
 * - Only adds the missing entry to the assistant named by `parentId`; never
 *   removes or reorders existing entries, so legitimate additions are untouched.
 * - Returns the SAME array reference when already consistent, so the callers'
 *   `isEqual` early-return and referential-equality checks still hold.
 */
export const reconcileAssistantToolLinks = (messages: UIChatMessage[]): UIChatMessage[] => {
  const byId = new Map<string, UIChatMessage>();
  for (const message of messages) byId.set(message.id, message);

  // assistant id -> tool entries present-as-rows but missing from its tools[]
  let missingByAssistant: Map<string, ChatToolPayload[]> | undefined;

  for (const message of messages) {
    if (message.role !== 'tool' || !message.tool_call_id || !message.parentId) continue;

    const parent = byId.get(message.parentId);
    if (!parent || parent.role !== 'assistant') continue;

    const alreadyLinked = (parent.tools ?? []).some((tool) => tool.id === message.tool_call_id);
    if (alreadyLinked) continue;

    // Reconstruct the assistant's tools[] entry from the tool message's own
    // plugin payload; `result_msg_id` points at the row itself so the UI can
    // hydrate the result.
    const entry = {
      apiName: message.plugin?.apiName ?? '',
      arguments: message.plugin?.arguments ?? '{}',
      id: message.tool_call_id,
      identifier: message.plugin?.identifier ?? '',
      result_msg_id: message.id,
      type: message.plugin?.type ?? 'default',
    } as ChatToolPayload;

    missingByAssistant ??= new Map();
    const list = missingByAssistant.get(message.parentId);
    if (list) list.push(entry);
    else missingByAssistant.set(message.parentId, [entry]);
  }

  if (!missingByAssistant) return messages;

  return messages.map((message) => {
    const missing = missingByAssistant!.get(message.id);
    if (!missing) return message;
    return { ...message, tools: [...(message.tools ?? []), ...missing] };
  });
};
