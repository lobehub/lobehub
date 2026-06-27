import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import ContentLoading from '@/features/Conversation/Messages/components/ContentLoading';
import type { AssistantContentBlock } from '@/types/index';

import { messageStateSelectors, useConversationStore } from '../../../store';
import CouncilList from '../../AgentCouncil/components/CouncilList';
import { MessageAggregationContext } from '../../Contexts/MessageAggregationContext';
import { POST_TOOL_FINAL_ANSWER_SCORE_THRESHOLD } from '../constants';
import {
  areWorkflowToolsComplete,
  formatReasoningDuration,
  getPostToolAnswerSplitIndex,
  scoreBlockContentAsAnswerLike,
} from '../toolDisplayNames';
import { CollapsedMessage } from './CollapsedMessage';
import GroupItem from './GroupItem';
import ProcessFold from './ProcessFold';
import { type GroupRenderSegment, shouldFoldProcess, splitFinalAnswer } from './segments';
import type { RenderableAssistantContentBlock } from './types';
import WorkflowCollapse, { type WorkflowExpandLevelDefault } from './WorkflowCollapse';

const styles = createStaticStyles(({ css }) => {
  return {
    container: css`
      &:has(.tool-blocks) {
        width: 100%;
      }
    `,
  };
});

interface GroupChildrenProps {
  blocks: AssistantContentBlock[];
  content?: string;
  contentId?: string;
  defaultWorkflowExpandLevel?: WorkflowExpandLevelDefault;
  disableEditing?: boolean;
  /** Lab flag: fold finished non-latest turns' process under a "已处理" header. */
  enableProcessFold?: boolean;
  id: string;
  /** Whether this turn is the latest item in the conversation. */
  isLatestItem?: boolean;
  messageIndex: number;
}

/**
 * Wall-clock span of a turn = last − first `createdAt` across the turn's own
 * assistant-step messages (the group's child blocks resolved against the raw
 * `dbMessages`). The group record's own `createdAt/updatedAt` only covers its
 * final step, so it under-reports multi-step turns.
 */
const getTurnDurationMs = (
  dbMessages: { createdAt?: Date | number | string | null; id: string }[] | undefined,
  blocks: AssistantContentBlock[],
): number => {
  if (!Array.isArray(dbMessages) || blocks.length < 2) return 0;
  const ids = new Set(blocks.map((block) => block.id));
  let min = Infinity;
  let max = -Infinity;
  for (const message of dbMessages) {
    if (!ids.has(message.id) || message.createdAt == null) continue;
    const time =
      message.createdAt instanceof Date
        ? message.createdAt.getTime()
        : new Date(message.createdAt).getTime();
    if (Number.isNaN(time)) continue;
    if (time < min) min = time;
    if (time > max) max = time;
  }
  return max > min ? max - min : 0;
};

interface PartitionedBlocks {
  /** True while generating if long post-tool answer was moved outside the fold (tool phase UI may show “done”). */
  postToolTailPromoted: boolean;
  segments: GroupRenderSegment[];
}

const ANSWER_DOM_ID_SUFFIX = '__answer';
const WORKFLOW_DOM_ID_SUFFIX = '__workflow';

const isEmptyBlock = (block: RenderableAssistantContentBlock) =>
  (!block.content || block.content === LOADING_FLAT) &&
  (!block.tools || block.tools.length === 0) &&
  (!block.council || block.council.length === 0) &&
  !block.error &&
  !block.reasoning;

/**
 * Check if a block contains any tool calls.
 */
const hasTools = (block: AssistantContentBlock): boolean => {
  return !!block.tools && block.tools.length > 0;
};

const hasSubstantiveContent = (block: AssistantContentBlock): boolean => {
  const content = block.content?.trim();
  return !!content && content !== LOADING_FLAT;
};

const hasReasoningContent = (block: AssistantContentBlock): boolean => {
  return !!block.reasoning?.content?.trim();
};

const isTrailingReasoningCandidate = (block: AssistantContentBlock): boolean => {
  return hasReasoningContent(block) && !hasTools(block) && !block.error;
};

const createAnswerRenderBlock = (
  block: AssistantContentBlock,
  overrides: Partial<RenderableAssistantContentBlock> = {},
): RenderableAssistantContentBlock => {
  const content = 'content' in overrides ? overrides.content : block.content;
  const tools = 'tools' in overrides ? overrides.tools : block.tools;

  return {
    ...block,
    contentOverride: content,
    domId: `${block.id}${ANSWER_DOM_ID_SUFFIX}`,
    hasToolsOverride: !!tools?.length,
    renderKey: `${block.id}${ANSWER_DOM_ID_SUFFIX}`,
    ...overrides,
  };
};

const createWorkflowRenderBlock = (
  block: AssistantContentBlock,
  overrides: Partial<RenderableAssistantContentBlock> = {},
): RenderableAssistantContentBlock => {
  const content = 'content' in overrides ? overrides.content : block.content;
  const tools = 'tools' in overrides ? overrides.tools : block.tools;

  return {
    ...block,
    contentOverride: content,
    domId: `${block.id}${WORKFLOW_DOM_ID_SUFFIX}`,
    hasToolsOverride: !!tools?.length,
    renderKey: `${block.id}${WORKFLOW_DOM_ID_SUFFIX}`,
    ...overrides,
  };
};

const appendAnswerBlock = (
  segments: GroupRenderSegment[],
  block: RenderableAssistantContentBlock,
) => {
  segments.push({ block, kind: 'answer' });
};

const appendWorkflowBlock = (
  segments: GroupRenderSegment[],
  block: RenderableAssistantContentBlock,
) => {
  const lastSegment = segments.at(-1);

  if (lastSegment?.kind === 'workflow') {
    lastSegment.blocks.push(block);
    return;
  }

  segments.push({ blocks: [block], kind: 'workflow' });
};

const shouldPromoteMixedBlockContent = (block: AssistantContentBlock): boolean => {
  if (!hasTools(block) || !hasSubstantiveContent(block)) return false;

  return scoreBlockContentAsAnswerLike(block) >= POST_TOOL_FINAL_ANSWER_SCORE_THRESHOLD;
};

const appendWorkflowRangeBlock = (
  segments: GroupRenderSegment[],
  block: AssistantContentBlock,
  collapsesIntoWorkflow = false,
) => {
  if (block.error) {
    if (hasTools(block)) {
      appendWorkflowBlock(
        segments,
        createWorkflowRenderBlock(block, {
          content: '',
          error: undefined,
          imageList: undefined,
          reasoning: undefined,
        }),
      );
      appendAnswerBlock(
        segments,
        createAnswerRenderBlock(block, {
          reasoning: undefined,
          tools: undefined,
        }),
      );
      return;
    }

    appendAnswerBlock(segments, block);
    return;
  }

  // Mixed blocks keep their natural order: assistant prose precedes tool_use.
  // Short step/status prose belongs with the workflow so adjacent tools can
  // still fold together; answer-like prose is lifted above the fold so it does
  // not disappear inside a collapsed WorkflowCollapse.
  if (collapsesIntoWorkflow && shouldPromoteMixedBlockContent(block)) {
    appendAnswerBlock(
      segments,
      createAnswerRenderBlock(block, {
        error: undefined,
        tools: undefined,
      }),
    );
    appendWorkflowBlock(
      segments,
      createWorkflowRenderBlock(block, {
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
  segments: GroupRenderSegment[],
  postBlocks: AssistantContentBlock[],
) => {
  let index = 0;
  while (index < postBlocks.length) {
    const block = postBlocks[index]!;
    if (!isTrailingReasoningCandidate(block)) break;

    appendWorkflowBlock(
      segments,
      createWorkflowRenderBlock(block, {
        content: '',
      }),
    );

    if (hasSubstantiveContent(block) || (block.imageList?.length ?? 0) > 0) {
      appendAnswerBlock(
        segments,
        createAnswerRenderBlock(block, {
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

/**
 * Partition blocks into ordered render segments. Workflow segments stay collapsible; answer
 * segments render inline so long prose can remain visible even when tools are present nearby.
 */
const partitionBlocks = (
  blocks: AssistantContentBlock[],
  isGenerating: boolean,
): PartitionedBlocks => {
  const segments: GroupRenderSegment[] = [];

  let lastToolIndex = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (hasTools(blocks[i])) {
      lastToolIndex = i;
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
  for (let i = 0; i < blocks.length; i++) {
    if (hasTools(blocks[i])) {
      firstToolIndex = i;
      break;
    }
  }

  const totalToolCount = blocks.reduce((sum, block) => sum + (block.tools?.length ?? 0), 0);

  for (const block of blocks.slice(0, firstToolIndex)) {
    appendAnswerBlock(segments, block);
  }

  if (isGenerating) {
    const toolsFlat = blocks.flatMap((b) => b.tools ?? []);
    const toolsPhaseComplete = areWorkflowToolsComplete(toolsFlat);
    let workingEndExclusive = blocks.length;
    let postToolTailPromoted = false;
    if (toolsPhaseComplete) {
      const split = getPostToolAnswerSplitIndex(blocks, lastToolIndex, toolsPhaseComplete, true);
      if (split != null) {
        workingEndExclusive = split;
        postToolTailPromoted = true;
      }
    }

    for (const block of blocks.slice(firstToolIndex, workingEndExclusive)) {
      appendWorkflowRangeBlock(segments, block, totalToolCount > 1);
    }

    for (const block of blocks.slice(workingEndExclusive)) {
      appendAnswerBlock(segments, block);
    }

    return {
      postToolTailPromoted,
      segments,
    };
  }

  for (const block of blocks.slice(firstToolIndex, lastToolIndex + 1)) {
    appendWorkflowRangeBlock(segments, block, totalToolCount > 1);
  }

  appendPostToolBlocks(segments, blocks.slice(lastToolIndex + 1));

  return {
    postToolTailPromoted: false,
    segments,
  };
};

const withMarkdownStreamingState = (
  block: RenderableAssistantContentBlock,
  lastBlockId: string | undefined,
): RenderableAssistantContentBlock => ({
  ...block,
  disableMarkdownStreaming: block.disableMarkdownStreaming || block.id !== lastBlockId,
});

const shouldInlineWorkflowSegment = (blocks: RenderableAssistantContentBlock[]): boolean => {
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
const hasRenderedContentAfter = (segments: GroupRenderSegment[], index: number): boolean =>
  segments
    .slice(index + 1)
    .some((seg) => (seg.kind === 'workflow' ? seg.blocks.length > 0 : !isEmptyBlock(seg.block)));

/**
 * A pending intervention still needs the user's confirmation, so the collapse
 * must keep its streaming "awaiting confirmation" chrome even when a later
 * segment has already rendered below it. `areWorkflowToolsComplete` ignores
 * pending tools, so the completion shortcut must not be applied here.
 */
const hasPendingIntervention = (blocks: RenderableAssistantContentBlock[]): boolean =>
  blocks.some((block) => block.tools?.some((tool) => tool.intervention?.status === 'pending'));

const Group = memo<GroupChildrenProps>(
  ({
    blocks,
    contentId,
    defaultWorkflowExpandLevel,
    disableEditing,
    messageIndex,
    id,
    content,
    isLatestItem,
    enableProcessFold,
  }) => {
    const [isCollapsed, isGenerating] = useConversationStore((s) => [
      messageStateSelectors.isMessageCollapsed(id)(s),
      messageStateSelectors.isAssistantGroupItemGenerating(id)(s),
    ]);
    const turnDurationMs = useConversationStore((s) => getTurnDurationMs(s.dbMessages, blocks));
    const contextValue = useMemo(() => ({ assistantGroupId: id }), [id]);
    const lastBlockId = blocks.at(-1)?.id;

    const { segments, postToolTailPromoted } = useMemo(
      () => partitionBlocks(blocks, isGenerating),
      [blocks, isGenerating],
    );

    const workflowChromeComplete = !isGenerating || postToolTailPromoted;

    // When the turn ends on an inline single-tool segment whose tool already
    // settled but the run is still generating (waiting on the next step), the
    // inline path renders no working chrome — unlike WorkflowCollapse, which has
    // its own streaming header. Without this the user sees a blank gap below the
    // finished tool. Render the same "running" indicator used at turn start to
    // fill it. Multi-tool segments keep their own chrome; a tool still executing
    // is covered by its own loading placeholder (areWorkflowToolsComplete=false).
    const lastSegment = segments.at(-1);
    const showTailRunningIndicator =
      isGenerating &&
      lastSegment?.kind === 'workflow' &&
      shouldInlineWorkflowSegment(lastSegment.blocks) &&
      areWorkflowToolsComplete(lastSegment.blocks.flatMap((block) => block.tools ?? []));

    if (isCollapsed) {
      return (
        content && (
          <Flexbox>
            <CollapsedMessage content={content} id={id} />
          </Flexbox>
        )
      );
    }

    const renderSegment = (segment: GroupRenderSegment, index: number) => {
      if (segment.kind === 'workflow') {
        if (segment.blocks.length === 0) return null;

        if (shouldInlineWorkflowSegment(segment.blocks)) {
          return segment.blocks.map((block, blockIndex) => {
            const item = withMarkdownStreamingState(block, lastBlockId);
            if (!isGenerating && isEmptyBlock(item)) return null;

            return (
              <GroupItem
                {...item}
                assistantId={id}
                contentId={contentId}
                disableEditing={disableEditing}
                key={item.renderKey ?? `${id}.workflow-inline.${index}.${blockIndex}`}
                messageIndex={messageIndex}
              />
            );
          });
        }

        return (
          <WorkflowCollapse
            assistantMessageId={id}
            blocks={segment.blocks.map((block) => withMarkdownStreamingState(block, lastBlockId))}
            defaultWorkflowExpandLevel={defaultWorkflowExpandLevel}
            disableEditing={disableEditing}
            key={segment.blocks[0]?.renderKey ?? `${id}.workflow.${index}`}
            workflowChromeComplete={
              workflowChromeComplete ||
              (hasRenderedContentAfter(segments, index) && !hasPendingIntervention(segment.blocks))
            }
          />
        );
      }

      const item = segment.block;

      // AgentCouncil block: broadcast members rendered as parallel columns inside
      // the supervisor's bubble.
      if (item.council && item.council.length > 0) {
        return (
          <CouncilList
            activeTab={0}
            displayMode={'horizontal'}
            key={item.renderKey ?? `${id}.${item.id}.${index}`}
            members={item.council}
          />
        );
      }

      if (!isGenerating && isEmptyBlock(item)) return null;

      return (
        <GroupItem
          {...withMarkdownStreamingState(item, lastBlockId)}
          assistantId={id}
          contentId={contentId}
          disableEditing={disableEditing}
          key={item.renderKey ?? `${id}.${item.id}.${index}`}
          messageIndex={messageIndex}
        />
      );
    };

    // Codex-style turn folding: once a turn is finished and no longer the latest
    // one, fold its whole process (reasoning + tools + intermediate prose) under
    // a single "已处理 {duration}" header, leaving the final answer always
    // visible. The latest / still-generating turn renders in full.
    const { processSegments, finalSegments } = splitFinalAnswer(segments);
    const foldProcess = shouldFoldProcess({
      enabled: enableProcessFold,
      isGenerating,
      isLatestItem,
      processSegments,
    });

    const durationText =
      turnDurationMs >= 1000 ? formatReasoningDuration(turnDurationMs) : undefined;

    return (
      <MessageAggregationContext value={contextValue}>
        <Flexbox className={styles.container} gap={8}>
          {foldProcess ? (
            <>
              <ProcessFold durationText={durationText} stepCount={blocks.length}>
                <Flexbox gap={8}>
                  {processSegments.map((segment, index) => renderSegment(segment, index))}
                </Flexbox>
              </ProcessFold>
              {finalSegments.map((segment, index) =>
                renderSegment(segment, processSegments.length + index),
              )}
            </>
          ) : (
            <>
              {segments.map((segment, index) => renderSegment(segment, index))}
              {showTailRunningIndicator && <ContentLoading id={id} />}
            </>
          )}
        </Flexbox>
      </MessageAggregationContext>
    );
  },
  isEqual,
);

export default Group;
