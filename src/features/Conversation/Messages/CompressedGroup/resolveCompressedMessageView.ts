import type { UIChatMessage } from '@lobechat/types';

/**
 * How one message inside a compressed group is rendered — the history view
 * reuses the live conversation's components rather than re-implementing them.
 */
export type CompressedMessageView =
  | 'assistant-content'
  /** The assistant-group chain renderer, which folds the turn's process. */
  | 'assistant-turn-chain'
  | 'none'
  | 'user';

/**
 * A turn that used tools must go through the assistant-group chain renderer
 * (`AssistantGroup/components/Group`, with process folding on): that renderer
 * folds the turn's process — reasoning, tool calls and intermediate prose —
 * under one turn-process header ("共运行 {n} 步") and keeps only the final
 * answer visible.
 *
 * Rendering such a turn's blocks one by one instead expands every step of the
 * historical turn into the history view at once, which is not how the same turn
 * reads in the conversation above it.
 */
export const resolveCompressedMessageView = (
  message: Pick<UIChatMessage, 'children' | 'role'>,
): CompressedMessageView => {
  if (message.role === 'user') return 'user';

  // A tool-less assistant message is a single answer block: nothing to fold.
  if (message.role === 'assistant') return 'assistant-content';

  if (message.role === 'assistantGroup' && message.children) return 'assistant-turn-chain';

  // Other roles (tool, system, …) are not rendered in the history view.
  return 'none';
};
