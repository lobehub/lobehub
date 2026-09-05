import type { AssistantGroupSegment } from '@lobechat/conversation-flow';

import { LOADING_FLAT } from '@/const/message';

import type { RenderableAssistantContentBlock } from './types';
import type { WorkflowExpandLevel, WorkflowExpandLevelDefault } from './WorkflowCollapse';

export type GroupRenderSegment = AssistantGroupSegment<RenderableAssistantContentBlock>;

export const countAssistantLlmCalls = (segments: GroupRenderSegment[]): number => {
  const assistantBlockIds = new Set<string>();

  for (const segment of segments) {
    if (segment.kind === 'answer') {
      assistantBlockIds.add(segment.block.id);
      continue;
    }

    for (const block of segment.blocks) {
      assistantBlockIds.add(block.id);
    }
  }

  return assistantBlockIds.size;
};

export const hasRenderableFinalAnswer = (segments: GroupRenderSegment[]): boolean =>
  segments.some((segment) => {
    if (segment.kind !== 'answer') return false;

    const block = segment.block;
    const content = (block.contentOverride ?? block.content)?.trim();

    return (
      (!!content && content !== LOADING_FLAT) ||
      !!block.council?.length ||
      !!block.error ||
      !!block.reasoning?.content?.trim()
    );
  });

/**
 * Whether a turn folds its process under the "已处理" header. Gated by the
 * `enabled` lab flag, then: only after the associated operation has ended and
 * the message is not generating. The latest turn is eligible only once its final
 * answer is visible, so a tool-only latest turn does not collapse into a lone
 * header.
 */
export const shouldFoldProcess = ({
  enabled,
  hasFinalAnswer,
  isGenerating,
  isLatestItem,
  operationEnded,
  processSegments,
}: {
  enabled?: boolean;
  hasFinalAnswer?: boolean;
  isGenerating: boolean;
  isLatestItem?: boolean;
  operationEnded: boolean;
  processSegments: GroupRenderSegment[];
}): boolean =>
  !!enabled &&
  operationEnded &&
  (!isLatestItem || !!hasFinalAnswer) &&
  !isGenerating &&
  processSegments.some((segment) => segment.kind === 'workflow');

/**
 * Merge the per-surface expand override with the user's streaming preference.
 * An explicit override always wins; the setting only fills a streaming phase
 * nobody asked for.
 */
export const resolveWorkflowExpandLevel = (
  override: WorkflowExpandLevelDefault | undefined,
  streamingSetting: WorkflowExpandLevel,
): WorkflowExpandLevelDefault => {
  const explicit =
    typeof override === 'string' ? { completion: override, streaming: override } : override;

  return { ...explicit, streaming: explicit?.streaming ?? streamingSetting };
};
