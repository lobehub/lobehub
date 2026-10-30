import type { AssistantGroupSegment } from '@lobechat/conversation-flow';

import { LOADING_FLAT } from '@/const/message';

import { isImageOutputTool, isMcpAppTool } from '../toolRenderRules';
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
 *
 * A turn whose process carries a PRODUCED image never folds — that image is
 * the deliverable. An MCP App view is lifted out of the fold instead (see
 * {@link liftMcpAppSegments}), so the rest of the process still folds. A tool
 * that merely READ an image no longer blocks folding: the read is one ordinary
 * step, and it surfaces (with its preview) once the fold is expanded instead of
 * holding the whole process open.
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
  processSegments.some((segment) => segment.kind === 'workflow') &&
  !processSegments.some((segment) =>
    (segment.kind === 'answer' ? [segment.block] : segment.blocks).some((block) =>
      block.tools?.some(isImageOutputTool),
    ),
  );

const isMcpAppSegment = (segment: GroupRenderSegment): boolean =>
  segment.kind === 'workflow' &&
  segment.blocks.length > 0 &&
  segment.blocks.every((block) => !!block.tools?.length && block.tools.every(isMcpAppTool));

/**
 * Take the MCP App views out of a turn's folded process. Like an image the turn
 * produced, the view is what the user came for, so it stays on screen between
 * the fold and the answer while the other steps fold as usual. Only a segment
 * made of MCP App tools alone is lifted: the workflow partition already breaks
 * each view out of a multi-tool run (`isBreakoutTool`), and a single-tool turn
 * renders its one tool inline.
 */
export const liftMcpAppSegments = (
  processSegments: GroupRenderSegment[],
): { folded: GroupRenderSegment[]; lifted: GroupRenderSegment[] } => {
  const folded: GroupRenderSegment[] = [];
  const lifted: GroupRenderSegment[] = [];
  for (const segment of processSegments) {
    (isMcpAppSegment(segment) ? lifted : folded).push(segment);
  }

  return { folded, lifted };
};

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
