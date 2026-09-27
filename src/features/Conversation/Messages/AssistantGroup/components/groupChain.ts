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

type DbMessageLike = {
  createdAt?: Date | number | string | null;
  id: string;
  updatedAt?: Date | number | string | null;
};

/** Anything that resolves to step rows in `dbMessages` — blocks, or their
 *  rendered projections, which keep the source block id. */
type BlockTimeSource = { id: string; tools?: { result_msg_id?: string | null }[] };

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
 * Earliest `createdAt` among a set of steps, normalized to epoch ms. Anchors a
 * workflow collapse to the fold's own first entry instead of the operation
 * start — a long run folds into several collapses, and anchoring them all to
 * the op would print the same run-long number on each.
 */
export const getFirstBlockCreatedAt = (
  dbMessages: DbMessageLike[] | undefined,
  blocks: BlockTimeSource[],
): number | undefined => {
  if (!Array.isArray(dbMessages) || blocks.length === 0) return undefined;

  const ids = new Set(blocks.map((block) => block.id));
  let earliest: number | undefined;
  for (const message of dbMessages) {
    if (!ids.has(message.id)) continue;
    const time = toEpochMs(message.createdAt);
    if (time === undefined) continue;
    if (earliest === undefined || time < earliest) earliest = time;
  }
  return earliest;
};

/**
 * When a set of steps finished, normalized to epoch ms.
 *
 * When a step ends on tool calls, its freshest message is the tool RESULT row
 * (`result_msg_id`) — not the assistant block that issued the call. Taking the
 * block ids alone would end the span before the tools it is waiting on, so the
 * result rows join the candidates.
 *
 * A result row's own end is `updatedAt`, not `createdAt`: the client runtime
 * creates the row BEFORE invoking the tool (`ClientToolTransport.execute`) and
 * writes the result into it afterwards, so `createdAt` there marks when the
 * tool STARTED and would leave a slow tool's whole runtime outside the span.
 * The server runtime writes the row once, on completion, where the two stamps
 * coincide — so the later of the two is right on both paths. Assistant blocks
 * keep `createdAt` only: their `updatedAt` also moves when the message is
 * edited later, which has nothing to do with how long the step took.
 */
export const getBlocksEndCreatedAt = (
  dbMessages: DbMessageLike[] | undefined,
  blocks: BlockTimeSource[],
): number | undefined => {
  if (!Array.isArray(dbMessages) || blocks.length === 0) return undefined;

  const blockIds = new Set<string>();
  const resultIds = new Set<string>();
  for (const block of blocks) {
    blockIds.add(block.id);
    for (const tool of block.tools ?? []) {
      if (tool.result_msg_id) resultIds.add(tool.result_msg_id);
    }
  }

  let latest: number | undefined;
  for (const message of dbMessages) {
    const isResult = resultIds.has(message.id);
    if (!isResult && !blockIds.has(message.id)) continue;

    const created = toEpochMs(message.createdAt);
    const settled = isResult ? toEpochMs(message.updatedAt) : undefined;
    for (const time of [created, settled]) {
      if (time === undefined) continue;
      if (latest === undefined || time > latest) latest = time;
    }
  }
  return latest;
};

/**
 * When the turn's last step finished. Used to anchor the tail running
 * indicator's elapsed timer to "time since the last step" instead of the whole
 * run — the operation's own startTime marks the run's beginning, and folding a
 * finished tool's runtime back into the elapsed time defeats the point.
 */
export const getLastBlockCreatedAt = (
  dbMessages: DbMessageLike[] | undefined,
  lastBlock: AssistantContentBlock | undefined,
): number | undefined => getBlocksEndCreatedAt(dbMessages, lastBlock ? [lastBlock] : []);

export const isEmptyBlock = (block: RenderableAssistantContentBlock) =>
  (!block.content || block.content === LOADING_FLAT) &&
  (!block.tools || block.tools.length === 0) &&
  (!block.council || block.council.length === 0) &&
  !block.error &&
  !block.reasoning &&
  !block.metadata?.finishType;

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
