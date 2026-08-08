import { LOADING_FLAT } from '@lobechat/const';
import type { AssistantContentBlock, UIChatMessage } from '@lobechat/types';

const ASSISTANT_GROUP_STATUS_TEXT_MAX_LENGTH = 100;
const MARKDOWN_HEADING_MAX_LEVEL = 6;

export type AssistantGroupBlockProjection = 'answer' | 'workflow';

/**
 * A semantic view of an assistant block. `projection` is present only when one
 * persisted block must be rendered twice: its answer content outside the fold
 * and its workflow content inside it.
 */
export interface AssistantGroupSemanticBlock extends AssistantContentBlock {
  projection?: AssistantGroupBlockProjection;
}

export interface AssistantGroupAnswerSegment<
  Block extends AssistantContentBlock = AssistantGroupSemanticBlock,
> {
  block: Block;
  kind: 'answer';
}

export interface AssistantGroupWorkflowSegment<
  Block extends AssistantContentBlock = AssistantGroupSemanticBlock,
> {
  blocks: Block[];
  kind: 'workflow';
}

export type AssistantGroupSegment<
  Block extends AssistantContentBlock = AssistantGroupSemanticBlock,
> = AssistantGroupAnswerSegment<Block> | AssistantGroupWorkflowSegment<Block>;

export interface PartitionAssistantGroupOptions {
  isGenerating: boolean;
  /**
   * Whether all non-intervention tools have settled. Only used while generating
   * to promote a streamed post-tool answer before the operation itself ends.
   */
  toolsPhaseComplete?: boolean;
}

export interface PartitionedAssistantGroup {
  /** Whether a generating post-tool answer was promoted outside the workflow. */
  postToolTailPromoted: boolean;
  segments: AssistantGroupSegment[];
}

export interface SplitAssistantGroupSegments<
  Block extends AssistantContentBlock = AssistantGroupSemanticBlock,
> {
  finalSegments: AssistantGroupSegment<Block>[];
  processSegments: AssistantGroupSegment<Block>[];
}

const normalizeAuthoredContent = (content?: string | null) => {
  if (!content?.trim() || content === LOADING_FLAT) return;
  return content;
};

const hasTools = (block: AssistantContentBlock): boolean => !!block.tools?.length;

const hasSubstantiveContent = (block: AssistantContentBlock): boolean =>
  !!normalizeAuthoredContent(block.content);

const hasReasoningContent = (block: AssistantContentBlock): boolean =>
  !!block.reasoning?.content?.trim();

const isTrailingReasoningCandidate = (block: AssistantContentBlock): boolean =>
  hasReasoningContent(block) && !hasTools(block) && !block.error;

const createProjectedBlock = (
  block: AssistantContentBlock,
  projection: AssistantGroupBlockProjection,
  overrides: Partial<AssistantContentBlock>,
): AssistantGroupSemanticBlock => ({
  ...block,
  ...overrides,
  projection,
});

const appendAnswerBlock = (
  segments: AssistantGroupSegment[],
  block: AssistantGroupSemanticBlock,
) => {
  segments.push({ block, kind: 'answer' });
};

const appendWorkflowBlock = (
  segments: AssistantGroupSegment[],
  block: AssistantGroupSemanticBlock,
) => {
  const lastSegment = segments.at(-1);

  if (lastSegment?.kind === 'workflow') {
    lastSegment.blocks.push(block);
    return;
  }

  segments.push({ blocks: [block], kind: 'workflow' });
};

/**
 * Whether assistant prose reads as a short workflow status rather than answer content.
 * This classification is shared by semantic segmentation and every consumer of its output.
 */
export const isAssistantGroupStatusText = (content?: string | null): boolean => {
  const raw = content?.trim() ?? '';
  if (!raw || raw === LOADING_FLAT) return true;
  if (raw.includes('\n')) return false;

  if (new RegExp(`^#{1,${MARKDOWN_HEADING_MAX_LEVEL}}\\s`).test(raw) || /^[-*]\s+\S/.test(raw))
    return false;

  if (raw.length > ASSISTANT_GROUP_STATUS_TEXT_MAX_LENGTH) return false;

  const sentenceCount = (raw.match(/[。！？]|[.!?](?=\s|$)/g) ?? []).length;
  return sentenceCount <= 1;
};

const shouldPromoteMixedBlockContent = (block: AssistantContentBlock): boolean =>
  hasTools(block) && hasSubstantiveContent(block) && !isAssistantGroupStatusText(block.content);

const appendWorkflowRangeBlock = (
  segments: AssistantGroupSegment[],
  block: AssistantContentBlock,
  collapsesIntoWorkflow: boolean,
) => {
  if (block.error) {
    if (hasTools(block)) {
      appendWorkflowBlock(
        segments,
        createProjectedBlock(block, 'workflow', {
          content: '',
          error: undefined,
          imageList: undefined,
          reasoning: undefined,
        }),
      );
      appendAnswerBlock(
        segments,
        createProjectedBlock(block, 'answer', {
          reasoning: undefined,
          tools: undefined,
        }),
      );
      return;
    }

    appendAnswerBlock(segments, block);
    return;
  }

  if (collapsesIntoWorkflow && shouldPromoteMixedBlockContent(block)) {
    appendAnswerBlock(
      segments,
      createProjectedBlock(block, 'answer', {
        error: undefined,
        tools: undefined,
      }),
    );
    appendWorkflowBlock(
      segments,
      createProjectedBlock(block, 'workflow', {
        content: '',
        imageList: undefined,
        reasoning: undefined,
      }),
    );
    return;
  }

  appendWorkflowBlock(segments, block);
};

const appendPostToolBlocks = (
  segments: AssistantGroupSegment[],
  postBlocks: AssistantContentBlock[],
) => {
  let index = 0;
  while (index < postBlocks.length) {
    const block = postBlocks[index]!;
    if (!isTrailingReasoningCandidate(block)) break;

    appendWorkflowBlock(
      segments,
      createProjectedBlock(block, 'workflow', {
        content: '',
      }),
    );

    if (hasSubstantiveContent(block) || (block.imageList?.length ?? 0) > 0) {
      appendAnswerBlock(
        segments,
        createProjectedBlock(block, 'answer', {
          reasoning: undefined,
        }),
      );
    }

    index += 1;
  }

  for (const block of postBlocks.slice(index)) {
    appendAnswerBlock(segments, block);
  }
};

const getGeneratingAnswerSplitIndex = (
  blocks: AssistantContentBlock[],
  lastToolIndex: number,
  toolsPhaseComplete: boolean,
): number | null => {
  if (!toolsPhaseComplete || lastToolIndex < 0 || lastToolIndex >= blocks.length - 1) return null;

  for (let index = lastToolIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (hasTools(block)) return null;
    if (!isAssistantGroupStatusText(block.content)) return index;
  }

  return null;
};

/**
 * Partition assistant blocks into stable semantic segments. The result owns the
 * answer/workflow decision; renderers only decorate the projected blocks with
 * presentation metadata such as DOM ids.
 */
export const partitionAssistantGroupBlocks = (
  blocks: AssistantContentBlock[],
  options: PartitionAssistantGroupOptions,
): PartitionedAssistantGroup => {
  const segments: AssistantGroupSegment[] = [];

  let lastToolIndex = -1;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (hasTools(blocks[index]!)) {
      lastToolIndex = index;
      break;
    }
  }

  if (lastToolIndex === -1) {
    for (const block of blocks) {
      appendAnswerBlock(segments, block);
    }

    return { postToolTailPromoted: false, segments };
  }

  let firstToolIndex = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    if (hasTools(blocks[index]!)) {
      firstToolIndex = index;
      break;
    }
  }

  const totalToolCount = blocks.reduce((sum, block) => sum + (block.tools?.length ?? 0), 0);

  for (const block of blocks.slice(0, firstToolIndex)) {
    appendAnswerBlock(segments, block);
  }

  if (options.isGenerating) {
    const answerSplitIndex = getGeneratingAnswerSplitIndex(
      blocks,
      lastToolIndex,
      !!options.toolsPhaseComplete,
    );
    const workflowEndIndex = answerSplitIndex ?? blocks.length;

    for (const block of blocks.slice(firstToolIndex, workflowEndIndex)) {
      appendWorkflowRangeBlock(segments, block, totalToolCount > 1);
    }

    for (const block of blocks.slice(workflowEndIndex)) {
      appendAnswerBlock(segments, block);
    }

    return {
      postToolTailPromoted: answerSplitIndex !== null,
      segments,
    };
  }

  for (const block of blocks.slice(firstToolIndex, lastToolIndex + 1)) {
    appendWorkflowRangeBlock(segments, block, totalToolCount > 1);
  }

  appendPostToolBlocks(segments, blocks.slice(lastToolIndex + 1));

  return { postToolTailPromoted: false, segments };
};

/**
 * Split semantic segments into process and final-answer runs. Trailing workflow
 * segments remain process even when they follow the final answer.
 */
export const splitAssistantGroupFinalAnswer = <Block extends AssistantContentBlock>(
  segments: AssistantGroupSegment<Block>[],
): SplitAssistantGroupSegments<Block> => {
  let lastAnswerIndex = -1;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index]!.kind === 'answer') {
      lastAnswerIndex = index;
      break;
    }
  }

  if (lastAnswerIndex === -1) {
    return { finalSegments: [], processSegments: segments };
  }

  let runStart = lastAnswerIndex;
  while (runStart > 0 && segments[runStart - 1]!.kind === 'answer') {
    runStart -= 1;
  }

  return {
    finalSegments: segments.slice(runStart, lastAnswerIndex + 1),
    processSegments: [...segments.slice(0, runStart), ...segments.slice(lastAnswerIndex + 1)],
  };
};

interface AssistantGroupAuthoredContent {
  answer?: string;
  finalAnswer?: string;
}

const resolveLatestAnswerContent = (segments: AssistantGroupSegment[]): string | undefined => {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment?.kind !== 'answer') continue;

    const content = normalizeAuthoredContent(segment.block.content);
    if (content) return content;
  }
};

const resolveSegmentedAuthoredContent = (
  blocks?: AssistantContentBlock[],
): AssistantGroupAuthoredContent => {
  if (!blocks?.length) return {};

  const { segments } = partitionAssistantGroupBlocks(blocks, { isGenerating: false });
  const { finalSegments } = splitAssistantGroupFinalAnswer(segments);

  return {
    answer: resolveLatestAnswerContent(segments),
    finalAnswer: resolveLatestAnswerContent(finalSegments),
  };
};

const resolveLatestAuthoredContent = (blocks?: AssistantContentBlock[]): string | undefined => {
  for (let index = (blocks?.length ?? 0) - 1; index >= 0; index -= 1) {
    const content = normalizeAuthoredContent(blocks?.[index]?.content);
    if (content) return content;
  }
};

/**
 * Resolve the authored text that best represents a parsed assistant group.
 *
 * Both the main chain and post-task summaries use the same settled semantic
 * segmentation as the renderer. A textless final run (for example, an error-only
 * block) falls back through earlier answer segments before raw block content so
 * workflow narration cannot replace an authored answer in the preview.
 */
export const resolveAssistantGroupFinalContent = (message?: UIChatMessage): string | undefined => {
  const taskContent = resolveSegmentedAuthoredContent(message?.taskCompletions);
  const childContent = resolveSegmentedAuthoredContent(message?.children);

  return (
    taskContent.finalAnswer ??
    childContent.finalAnswer ??
    normalizeAuthoredContent(message?.content) ??
    taskContent.answer ??
    childContent.answer ??
    resolveLatestAuthoredContent(message?.taskCompletions) ??
    resolveLatestAuthoredContent(message?.children)
  );
};
