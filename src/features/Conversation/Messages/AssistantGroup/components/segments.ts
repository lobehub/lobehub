import type { AssistantGroupSegment } from '@lobechat/conversation-flow';
import { splitAssistantGroupFinalAnswer } from '@lobechat/conversation-flow';

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

const isMcpAppBlock = (block: RenderableAssistantContentBlock): boolean =>
  !!block.tools?.length && block.tools.every(isMcpAppTool);

/**
 * Take the MCP App views out of a turn's folded process. Like an image the turn
 * produced, the view is what the user came for, so it stays on screen between
 * the fold and the answer while the other steps fold as usual. A block of MCP
 * App tools alone is lifted: the workflow partition already breaks each view
 * out of a multi-tool run (`isBreakoutTool`). A lone view may share its segment
 * with tool-less neighbours (the answer's reasoning after it), which stay in
 * the fold, in their order.
 */
export const liftMcpAppSegments = (
  processSegments: GroupRenderSegment[],
): { folded: GroupRenderSegment[]; lifted: GroupRenderSegment[] } => {
  const folded: GroupRenderSegment[] = [];
  const lifted: GroupRenderSegment[] = [];
  for (const segment of processSegments) {
    if (segment.kind !== 'workflow' || !segment.blocks.some(isMcpAppBlock)) {
      folded.push(segment);
      continue;
    }
    if (segment.blocks.every(isMcpAppBlock)) {
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
      const isView = isMcpAppBlock(block);
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
 * the final answer, the process steps that fold, and the MCP App views lifted
 * out between the fold and the answer. With the `mcp_apps` flag off, nothing
 * is lifted and a view folds with the rest of the process.
 */
export const splitProcessForFold = (
  segments: GroupRenderSegment[],
  { enableMcpApps }: { enableMcpApps: boolean },
) => {
  const split = splitAssistantGroupFinalAnswer(segments);
  const { folded, lifted } = enableMcpApps
    ? liftMcpAppSegments(split.processSegments)
    : { folded: split.processSegments, lifted: [] };

  return { ...split, liftedSegments: lifted, processSegments: folded };
};
