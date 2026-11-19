import type { AssistantGroupSegment } from '@lobechat/conversation-flow';
import { splitAssistantGroupFinalAnswer } from '@lobechat/conversation-flow';
import { isCodexAsyncQuestion } from '@lobechat/heterogeneous-agents/client';

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
 * the deliverable. Interactive tool cards are lifted out so the rest of the process still folds. A tool
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

/**
 * Keep interactive cards visible after the run ends. The workflow partition
 * already breaks them out of mixed tool runs, leaving ordinary steps in the fold.
 */
export const liftInteractiveToolSegments = (
  processSegments: GroupRenderSegment[],
  enableMcpApps: boolean,
): { folded: GroupRenderSegment[]; lifted: GroupRenderSegment[] } => {
  const isInteractiveBlock = (block: RenderableAssistantContentBlock) =>
    !!block.tools?.length &&
    block.tools.every(
      (tool) => isCodexAsyncQuestion(tool) || (enableMcpApps && isMcpAppTool(tool)),
    );

  const folded: GroupRenderSegment[] = [];
  const lifted: GroupRenderSegment[] = [];
  for (const segment of processSegments) {
    if (segment.kind !== 'workflow' || !segment.blocks.some(isInteractiveBlock)) {
      folded.push(segment);
      continue;
    }
    if (segment.blocks.every(isInteractiveBlock)) {
      lifted.push(segment);
      continue;
    }

    // Each run of views is lifted, each run of other blocks folds
    let run: RenderableAssistantContentBlock[] = [];
    let runIsView = false;
    const flush = () => {
      if (run.length > 0) (runIsView ? lifted : folded).push({ ...segment, blocks: run });
      run = [];
    };
    for (const block of segment.blocks) {
      const isView = isInteractiveBlock(block);
      if (isView !== runIsView) flush();
      runIsView = isView;
      run.push(block);
    }
    flush();
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

/**
 * One turn's segments as the group lays them out once its process may fold:
 * the final answer, the process steps that fold, and the interactive cards
 * lifted out between the fold and the answer.
 */
export const splitProcessForFold = (
  segments: GroupRenderSegment[],
  { enableMcpApps }: { enableMcpApps: boolean },
) => {
  const split = splitAssistantGroupFinalAnswer(segments);
  const { folded, lifted } = liftInteractiveToolSegments(split.processSegments, enableMcpApps);

  return { ...split, liftedSegments: lifted, processSegments: folded };
};
