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
 * The trailing run of `answer` segments is the final answer (always shown);
 * everything before it — tools, reasoning, intermediate prose — is the process
 * that folds under the Codex-style "已处理 {duration}" header.
 */
export const splitFinalAnswer = (
  segments: GroupRenderSegment[],
): { finalSegments: GroupRenderSegment[]; processSegments: GroupRenderSegment[] } => {
  let splitIndex = segments.length;
  while (splitIndex > 0 && segments[splitIndex - 1].kind === 'answer') {
    splitIndex -= 1;
  }
  return {
    finalSegments: segments.slice(splitIndex),
    processSegments: segments.slice(0, splitIndex),
  };
};

/**
 * Whether a turn folds its process under the "已处理" header. Gated by the
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
