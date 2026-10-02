import type { UIChatMessage } from '@lobechat/types';

/** A replacement user prompt; message attachments remain associated with the same row. */
export interface CodexMessageEdit {
  /** The replacement text to persist and send. */
  content: string;
  /** Updated rich editor state. Omitted state preserves the original attachments and references. */
  editorData?: Record<string, unknown>;
}

/**
 * Selects the persisted ancestry immediately before an edited Codex user message.
 *
 * Use when:
 * - Starting a replacement Codex session without the superseded prompt and replies.
 *
 * Expects:
 * - Raw message rows with complete parent links for the selected message.
 *
 * Returns:
 * - Ancestors in conversation order, excluding the edited message and sibling branches.
 * - Throws before any write when history is missing or cyclic.
 */
export const getCodexEditAncestors = (
  messages: UIChatMessage[],
  messageId: string,
): UIChatMessage[] => {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const selected = byId.get(messageId);
  if (!selected || selected.role !== 'user')
    throw new Error('The selected user message is unavailable');

  const ancestors: UIChatMessage[] = [];
  const visited = new Set([messageId]);
  let parentId = selected.parentId;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent || visited.has(parentId)) {
      throw new Error('The conversation history is incomplete. Reload it before editing.');
    }
    visited.add(parentId);
    ancestors.push(parent);
    parentId = parent.parentId;
  }
  return ancestors.reverse();
};
