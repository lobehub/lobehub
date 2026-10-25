import type { UIChatMessage } from '@lobechat/types';

export const isCompressionSummaryGenerating = (operationType?: string) =>
  operationType === 'generateSummary' || operationType === 'contextCompression';

export const shouldShowCompressedGroupPanel = ({
  expanded,
  isGeneratingSummary,
}: {
  expanded: boolean;
  isGeneratingSummary: boolean;
}) => expanded && !isGeneratingSummary;

/**
 * How much history a compressed group folded away, counted in conversation
 * turns so the collapsed bar can say "the previous N turns".
 *
 * A capped read hydrates only the group's newest members, so the server's
 * whole-group `compressedTurnCount` wins when present. Otherwise the nested
 * messages are the only truthful count once they are loaded. Before that (and
 * on a group restored from a source that carries no detail) fall back to the
 * server-side `originalMessageCount`, which counts messages rather than turns
 * but still gives the reader a size.
 */
export const getCompressedTurnCount = ({
  compressedMessages,
  compressedTurnCount,
  originalMessageCount,
}: {
  compressedMessages?: UIChatMessage[];
  compressedTurnCount?: number;
  originalMessageCount?: number;
}) => {
  if (compressedTurnCount) return compressedTurnCount;

  if (compressedMessages?.length) {
    const userTurns = compressedMessages.filter((message) => message.role === 'user').length;

    return userTurns || compressedMessages.length;
  }

  return originalMessageCount ?? 0;
};
