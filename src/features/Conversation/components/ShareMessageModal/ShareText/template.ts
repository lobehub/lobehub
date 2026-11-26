import { type UIChatMessage } from '@lobechat/types';

import { LOADING_FLAT } from '@/const/message';
import { normalizeThinkTags, processWithArtifact } from '@/features/Conversation/utils/markdown';
import { flattenExportMessages } from '@/features/ShareModal/flattenExportMessages';

interface MarkdownParams {
  messages: UIChatMessage[];
}

/**
 * A multi-step reply (`assistantGroup` / `supervisor`) has an empty `content`
 * of its own; its text lives in `children`. Unfold it into its steps and keep
 * only their text, the same as sharing a single reply (whose tool results are
 * not part of the shared text either).
 */
const toShareMessages = (message: UIChatMessage): UIChatMessage[] => {
  const unfolded = flattenExportMessages([message]);
  if (unfolded.length === 1 && unfolded[0] === message) return unfolded;

  return unfolded.filter((step) => step.role !== 'tool' && !!step.content);
};

export const generateMarkdown = ({ messages }: MarkdownParams): string =>
  messages
    .flatMap(toShareMessages)
    .filter((m) => m.content !== LOADING_FLAT)
    .map((message) => normalizeThinkTags(processWithArtifact(message.content)))
    .join('\n\n');
