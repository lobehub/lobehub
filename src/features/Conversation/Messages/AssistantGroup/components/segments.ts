import { LOADING_FLAT } from '@/const/message';

import type { RenderableAssistantContentBlock } from './types';

export interface AnswerSegment {
  block: RenderableAssistantContentBlock;
  kind: 'answer';
}

export interface WorkflowSegment {
  blocks: RenderableAssistantContentBlock[];
  kind: 'workflow';
}

export type GroupRenderSegment = AnswerSegment | WorkflowSegment;

/**
 * Split a turn's render segments into its process and its final answer.
 *
 * The final answer is the *last run* of `answer` segments — even when one or
 * more bookkeeping tool calls (e.g. "mark task done", "update issue") trail it.
 * Those trailing workflow segments fold into the process alongside the leading
 * reasoning/tools so the answer text stays visible, rather than disappearing
 * inside the fold whenever a turn happens to end on a tool call. Everything that
 * is not the final answer — leading tools/reasoning/intermediate prose and any
 * trailing bookkeeping tools — folds under the Codex-style "已处理 {duration}"
 * header. A turn with no answer segment at all has no final answer to surface.
 */
export const splitFinalAnswer = (
  segments: GroupRenderSegment[],
): { finalSegments: GroupRenderSegment[]; processSegments: GroupRenderSegment[] } => {
  let lastAnswerIndex = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].kind === 'answer') {
      lastAnswerIndex = i;
      break;
    }
  }

  if (lastAnswerIndex === -1) {
    return { finalSegments: [], processSegments: segments };
  }

  let runStart = lastAnswerIndex;
  while (runStart > 0 && segments[runStart - 1].kind === 'answer') {
    runStart -= 1;
  }

  return {
    finalSegments: segments.slice(runStart, lastAnswerIndex + 1),
    processSegments: [...segments.slice(0, runStart), ...segments.slice(lastAnswerIndex + 1)],
  };
};

export const countFoldedProcessSteps = (segments: GroupRenderSegment[]): number => {
  const assistantBlockIds = new Set<string>();
  let toolCount = 0;

  for (const segment of segments) {
    if (segment.kind === 'answer') {
      assistantBlockIds.add(segment.block.id);
      continue;
    }

    for (const block of segment.blocks) {
      assistantBlockIds.add(block.id);
      toolCount += block.tools?.length ?? 0;
    }
  }

  return assistantBlockIds.size + toolCount;
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
