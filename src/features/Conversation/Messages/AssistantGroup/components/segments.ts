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
 * trailing bookkeeping tools — folds under the Codex-style "Processed {duration}"
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

/**
 * Whether a turn folds its process under the "Processed" header. Gated by the
 * `enabled` lab flag, then: only a finished (not generating), non-latest turn
 * that actually has a workflow to fold. The latest / still-generating turn
 * always renders in full.
 */
export const shouldFoldProcess = ({
  enabled,
  isGenerating,
  isLatestItem,
  processSegments,
}: {
  enabled?: boolean;
  isGenerating: boolean;
  isLatestItem?: boolean;
  processSegments: GroupRenderSegment[];
}): boolean =>
  !!enabled &&
  !isLatestItem &&
  !isGenerating &&
  processSegments.some((segment) => segment.kind === 'workflow');
