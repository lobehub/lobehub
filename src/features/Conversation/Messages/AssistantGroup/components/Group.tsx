import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import { type AssistantContentBlock } from '@/types/index';

import { messageStateSelectors, useConversationStore } from '../../../store';
import { MessageAggregationContext } from '../../Contexts/MessageAggregationContext';
import { POST_TOOL_FINAL_ANSWER_SCORE_THRESHOLD } from '../constants';
import {
  areWorkflowToolsComplete,
  getPostToolAnswerSplitIndex,
  scorePostToolBlockAsFinalAnswer,
} from '../toolDisplayNames';
import { CollapsedMessage } from './CollapsedMessage';
import GroupItem from './GroupItem';
import type { RenderableAssistantContentBlock } from './types';
import WorkflowCollapse, { type WorkflowExpandLevel } from './WorkflowCollapse';

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
  defaultWorkflowExpandLevel?: WorkflowExpandLevel;
  disableEditing?: boolean;
  id: string;
  messageIndex: number;
}

interface AnswerSegment {
  block: RenderableAssistantContentBlock;
  kind: 'answer';
}

interface WorkflowSegment {
  blocks: RenderableAssistantContentBlock[];
  kind: 'workflow';
}

type GroupRenderSegment = AnswerSegment | WorkflowSegment;

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
  return {
    ...block,
    domId: `${block.id}${ANSWER_DOM_ID_SUFFIX}`,
    renderKey: `${block.id}${ANSWER_DOM_ID_SUFFIX}`,
    ...overrides,
  };
};

const createWorkflowRenderBlock = (
  block: AssistantContentBlock,
  overrides: Partial<RenderableAssistantContentBlock> = {},
): RenderableAssistantContentBlock => {
  return {
    ...block,
    domId: `${block.id}${WORKFLOW_DOM_ID_SUFFIX}`,
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

  return (
    scorePostToolBlockAsFinalAnswer({ ...block, tools: undefined }) >=
    POST_TOOL_FINAL_ANSWER_SCORE_THRESHOLD
  );
};

const appendWorkflowRangeBlock = (segments: GroupRenderSegment[], block: AssistantContentBlock) => {
  if (!shouldPromoteMixedBlockContent(block)) {
    appendWorkflowBlock(segments, block);
    return;
  }

  appendAnswerBlock(
    segments,
    createAnswerRenderBlock(block, {
      error: undefined,
      reasoning: undefined,
      tools: undefined,
    }),
  );
  appendWorkflowBlock(
    segments,
    createWorkflowRenderBlock(block, {
      content: '',
      imageList: undefined,
    }),
  );
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
      appendWorkflowRangeBlock(segments, block);
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
    appendWorkflowRangeBlock(segments, block);
  }

  appendPostToolBlocks(segments, blocks.slice(lastToolIndex + 1));

  return {
    postToolTailPromoted: false,
    segments,
  };
};

const Group = memo<GroupChildrenProps>(
  ({
    blocks,
    contentId,
    defaultWorkflowExpandLevel,
    disableEditing,
    messageIndex,
    id,
    content,
  }) => {
    const [isCollapsed, isGenerating] = useConversationStore((s) => [
      messageStateSelectors.isMessageCollapsed(id)(s),
      messageStateSelectors.isMessageGenerating(id)(s),
    ]);
    const contextValue = useMemo(() => ({ assistantGroupId: id }), [id]);

    const { segments, postToolTailPromoted } = useMemo(
      () => partitionBlocks(blocks, isGenerating),
      [blocks, isGenerating],
    );

    const workflowChromeComplete = !isGenerating || postToolTailPromoted;

    if (isCollapsed) {
      return (
        content && (
          <Flexbox>
            <CollapsedMessage content={content} id={id} />
          </Flexbox>
        )
      );
    }

    return (
      <MessageAggregationContext value={contextValue}>
        <Flexbox className={styles.container} gap={8}>
          {segments.map((segment, index) => {
            if (segment.kind === 'workflow') {
              if (segment.blocks.length === 0) return null;

              return (
                <WorkflowCollapse
                  assistantMessageId={id}
                  blocks={segment.blocks}
                  defaultWorkflowExpandLevel={defaultWorkflowExpandLevel}
                  disableEditing={disableEditing}
                  key={segment.blocks[0]?.renderKey ?? `${id}.workflow.${index}`}
                  workflowChromeComplete={workflowChromeComplete}
                />
              );
            }

            const item = segment.block;
            if (!isGenerating && isEmptyBlock(item)) return null;

            return (
              <GroupItem
                {...item}
                assistantId={id}
                contentId={contentId}
                disableEditing={disableEditing}
                key={item.renderKey ?? `${id}.${item.id}.${index}`}
                messageIndex={messageIndex}
              />
            );
          })}
        </Flexbox>
      </MessageAggregationContext>
    );
  },
  isEqual,
);

export default Group;
