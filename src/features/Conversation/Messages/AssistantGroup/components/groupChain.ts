import type {
  AssistantGroupSegment,
  AssistantGroupSemanticBlock,
} from '@lobechat/conversation-flow';
import { partitionAssistantGroupBlocks } from '@lobechat/conversation-flow';

import { LOADING_FLAT } from '@/const/message';
import type { AssistantContentBlock } from '@/types/index';

import { areWorkflowToolsComplete } from '../toolDisplayNames';
import { isImageBearingTool } from '../toolRenderRules';
import type { GroupRenderSegment } from './segments';
import type { RenderableAssistantContentBlock } from './types';

const ANSWER_DOM_ID_SUFFIX = '__answer';
const WORKFLOW_DOM_ID_SUFFIX = '__workflow';

type DbMessageLike = { createdAt?: Date | number | string | null; id: string };

export interface GroupChainInput {
  blocks: AssistantContentBlock[];
  contentId?: string;
  id: string;
  steerUserId?: string;
}

export interface GroupChainView extends GroupChainInput {
  hasActiveOperation: boolean;
  isGenerating: boolean;
  lastBlockId?: string;
  postToolTailPromoted: boolean;
  segments: GroupRenderSegment[];
  showTailRunningIndicator: boolean;
  workflowChromeComplete: boolean;
}

const toEpochMs = (createdAt: DbMessageLike['createdAt']): number | undefined => {
  if (createdAt == null) return;
  const time = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  return Number.isNaN(time) ? undefined : time;
};

/**
 * Wall-clock span of a turn = last − first `createdAt` across the turn's own
 * assistant-step messages (the group's child blocks resolved against the raw
 * `dbMessages`). The group record's own `createdAt/updatedAt` only covers its
 * final step, so it under-reports multi-step turns.
 */
export const getTurnDurationMs = (
  dbMessages: DbMessageLike[] | undefined,
  blocks: AssistantContentBlock[],
): number => {
  if (!Array.isArray(dbMessages) || blocks.length < 2) return 0;
  const ids = new Set(blocks.map((block) => block.id));
  let min = Infinity;
  let max = -Infinity;
  for (const message of dbMessages) {
    if (!ids.has(message.id)) continue;
    const time = toEpochMs(message.createdAt);
    if (time === undefined) continue;
    if (time < min) min = time;
    if (time > max) max = time;
  }
  return max > min ? max - min : 0;
};

/**
 * `createdAt` of the turn's last step, normalized to epoch ms. Used to anchor the
 * tail running indicator's elapsed timer to "time since the last step" instead of
 * the whole run — the operation's own startTime marks the run's beginning.
 *
 * When the last block ends on tool calls, its freshest message is the tool RESULT
 * row (`result_msg_id`), created when the tool finished — not the assistant block
 * that issued the call. Anchoring to the block id alone would fold the tool's
 * runtime back into the elapsed time, defeating the point. So we take the latest
 * `createdAt` across the block and its tool-result rows.
 */
export const getLastBlockCreatedAt = (
  dbMessages: DbMessageLike[] | undefined,
  lastBlock: AssistantContentBlock | undefined,
): number | undefined => {
  if (!Array.isArray(dbMessages) || !lastBlock) return undefined;

  const candidateIds = new Set<string>([lastBlock.id]);
  for (const tool of lastBlock.tools ?? []) {
    if (tool.result_msg_id) candidateIds.add(tool.result_msg_id);
  }

  let latest: number | undefined;
  for (const message of dbMessages) {
    if (!candidateIds.has(message.id)) continue;
    const time = toEpochMs(message.createdAt);
    if (time === undefined) continue;
    if (latest === undefined || time > latest) latest = time;
  }
  return latest;
};

export const isEmptyBlock = (block: RenderableAssistantContentBlock) =>
  (!block.content || block.content === LOADING_FLAT) &&
  (!block.tools || block.tools.length === 0) &&
  (!block.council || block.council.length === 0) &&
  !block.error &&
  !block.reasoning;

const toRenderableBlock = (block: AssistantGroupSemanticBlock): RenderableAssistantContentBlock => {
  if (!block.projection) return block;

  const suffix = block.projection === 'answer' ? ANSWER_DOM_ID_SUFFIX : WORKFLOW_DOM_ID_SUFFIX;
  const key = `${block.projectionKey ?? block.id}${suffix}`;

  return {
    ...block,
    contentOverride: block.content,
    domId: key,
    hasToolsOverride: !!block.tools?.length,
    renderKey: key,
  };
};

const toRenderSegments = (segments: AssistantGroupSegment[]): GroupRenderSegment[] =>
  segments.map((segment) =>
    segment.kind === 'answer'
      ? { block: toRenderableBlock(segment.block), kind: 'answer' }
      : { ...segment, blocks: segment.blocks.map(toRenderableBlock) },
  );

export const withMarkdownStreamingState = (
  block: RenderableAssistantContentBlock,
  lastBlockId: string | undefined,
): RenderableAssistantContentBlock => ({
  ...block,
  disableMarkdownStreaming: block.disableMarkdownStreaming || block.id !== lastBlockId,
});

export const shouldInlineWorkflowSegment = (blocks: RenderableAssistantContentBlock[]): boolean => {
  let toolCount = 0;

  for (const block of blocks) {
    toolCount += block.tools?.length ?? 0;
    if (toolCount > 1) return false;
  }

  return toolCount === 1;
};

/**
 * A workflow segment is only the "active" step while it is the last thing in the
 * group. Once any later segment has real content below it (e.g. an errored
 * tool block whose error text renders as a trailing answer segment), the tools
 * are settled and the collapse should read as done rather than keep showing its
 * streaming "working" header. Empty trailing blocks (an answer not streamed yet)
 * don't count. `postToolTailPromoted` already covers the promoted-final-answer
 * path at the group level; this catches the remaining segment-ordering cases.
 */
export const hasRenderedContentAfter = (segments: GroupRenderSegment[], index: number): boolean =>
  segments
    .slice(index + 1)
    .some((seg) => (seg.kind === 'workflow' ? seg.blocks.length > 0 : !isEmptyBlock(seg.block)));

/**
 * A pending intervention still needs the user's confirmation, so the collapse
 * must keep its streaming "awaiting confirmation" chrome even when a later
 * segment has already rendered below it. `areWorkflowToolsComplete` ignores
 * pending tools, so the completion shortcut must not be applied here.
 */
export const hasPendingIntervention = (blocks: RenderableAssistantContentBlock[]): boolean =>
  blocks.some((block) => block.tools?.some((tool) => tool.intervention?.status === 'pending'));

export const buildChainView = (
  chain: GroupChainInput,
  state: { hasActiveOperation: boolean; isGenerating: boolean },
): GroupChainView => {
  const { isGenerating } = state;
  const partitioned = partitionAssistantGroupBlocks(chain.blocks, {
    isBreakoutTool: isImageBearingTool,
    isGenerating,
    toolsPhaseComplete: isGenerating
      ? areWorkflowToolsComplete(chain.blocks.flatMap((block) => block.tools ?? []))
      : undefined,
  });
  const segments = toRenderSegments(partitioned.segments);

  // When the turn ends on an inline single-tool segment whose tool already
  // settled but the run is still generating (waiting on the next step), the
  // inline path renders no working chrome — unlike WorkflowCollapse, which has
  // its own streaming header. Without this the user sees a blank gap below the
  // finished tool. Render the same "running" indicator used at turn start to
  // fill it. Multi-tool segments keep their own chrome; a tool still executing
  // is covered by its own loading placeholder (areWorkflowToolsComplete=false).
  // …unless that inline segment already ends on a LOADING_FLAT placeholder:
  // that block mounts MessageContent, which renders its OWN "…is running" line
  // (ContentBlock gates on text/LOADING_FLAT/tools), so the tail would stack a
  // second identical line on top. Narrowly LOADING_FLAT (and tool-less): a
  // blank `content: ''` shell — what the gateway emits on stream_start — does
  // NOT mount MessageContent, so the tail must stay to fill the gap until the
  // first content chunk lands.
  const lastSegment = segments.at(-1);
  const lastInlineBlock = lastSegment?.kind === 'workflow' ? lastSegment.blocks.at(-1) : undefined;
  const lastInlineRendersOwnLoading =
    lastInlineBlock?.content === LOADING_FLAT && !lastInlineBlock.tools?.length;
  const showTailRunningIndicator =
    isGenerating &&
    lastSegment?.kind === 'workflow' &&
    shouldInlineWorkflowSegment(lastSegment.blocks) &&
    areWorkflowToolsComplete(lastSegment.blocks.flatMap((block) => block.tools ?? [])) &&
    !lastInlineRendersOwnLoading;

  return {
    ...chain,
    hasActiveOperation: state.hasActiveOperation,
    isGenerating,
    lastBlockId: chain.blocks.at(-1)?.id,
    postToolTailPromoted: partitioned.postToolTailPromoted,
    segments,
    showTailRunningIndicator,
    workflowChromeComplete: !isGenerating || partitioned.postToolTailPromoted,
  };
};
