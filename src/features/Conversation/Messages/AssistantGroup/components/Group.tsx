import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import { type AssistantContentBlock } from '@/types/index';

import { messageStateSelectors, useConversationStore } from '../../../store';
import { MessageAggregationContext } from '../../Contexts/MessageAggregationContext';
import { areWorkflowToolsComplete, getPostToolAnswerSplitIndex } from '../toolDisplayNames';
import { CollapsedMessage } from './CollapsedMessage';
import GroupItem from './GroupItem';
import WorkflowCollapse from './WorkflowCollapse';

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
  defaultWorkflowExpanded?: boolean;
  disableEditing?: boolean;
  id: string;
  messageIndex: number;
}

interface PartitionedBlocks {
  answerBlocks: AssistantContentBlock[];
  /** True while generating if long post-tool answer was moved outside the fold (tool phase UI may show “done”). */
  postToolTailPromoted: boolean;
  workingBlocks: AssistantContentBlock[];
}

const isEmptyBlock = (block: AssistantContentBlock) =>
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

const splitPostToolBlocks = (
  postBlocks: AssistantContentBlock[],
): Pick<PartitionedBlocks, 'answerBlocks' | 'workingBlocks'> => {
  const answerBlocks: AssistantContentBlock[] = [];
  const workingBlocks: AssistantContentBlock[] = [];

  let index = 0;
  while (index < postBlocks.length) {
    const block = postBlocks[index]!;
    if (!isTrailingReasoningCandidate(block)) break;

    workingBlocks.push({ ...block, content: '' });

    if (hasSubstantiveContent(block) || (block.imageList?.length ?? 0) > 0) {
      answerBlocks.push({ ...block, reasoning: undefined });
    }

    index += 1;
  }

  answerBlocks.push(...postBlocks.slice(index));

  return { answerBlocks, workingBlocks };
};

/**
 * Partition blocks into "working phase" and "answer phase".
 *
 * Working phase: from first block with tools through last block with tools
 * (inclusive — interleaved content/reasoning blocks between tool blocks are included).
 *
 * Answer phase: blocks before the first tool block, plus blocks after the last tool
 * (or after detected post-tool “final answer” while still generating).
 */
const partitionBlocks = (
  blocks: AssistantContentBlock[],
  isGenerating: boolean,
): PartitionedBlocks => {
  let lastToolIndex = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (hasTools(blocks[i])) {
      lastToolIndex = i;
      break;
    }
  }

  if (lastToolIndex === -1) {
    return { answerBlocks: blocks, postToolTailPromoted: false, workingBlocks: [] };
  }

  let firstToolIndex = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (hasTools(blocks[i])) {
      firstToolIndex = i;
      break;
    }
  }

  const preBlocks = blocks.slice(0, firstToolIndex);

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

    return {
      answerBlocks: [...preBlocks, ...blocks.slice(workingEndExclusive)],
      postToolTailPromoted,
      workingBlocks: blocks.slice(firstToolIndex, workingEndExclusive),
    };
  }

  const postBlocks = blocks.slice(lastToolIndex + 1);
  const postToolReasoning = splitPostToolBlocks(postBlocks);
  const workingBlocks = [
    ...blocks.slice(firstToolIndex, lastToolIndex + 1),
    ...postToolReasoning.workingBlocks,
  ];

  return {
    answerBlocks: [...preBlocks, ...postToolReasoning.answerBlocks],
    postToolTailPromoted: false,
    workingBlocks,
  };
};

const Group = memo<GroupChildrenProps>(
  ({ blocks, contentId, defaultWorkflowExpanded, disableEditing, messageIndex, id, content }) => {
    const [isCollapsed, isGenerating] = useConversationStore((s) => [
      messageStateSelectors.isMessageCollapsed(id)(s),
      messageStateSelectors.isMessageGenerating(id)(s),
    ]);
    const contextValue = useMemo(() => ({ assistantGroupId: id }), [id]);

    const { workingBlocks, answerBlocks, postToolTailPromoted } = useMemo(
      () => partitionBlocks(blocks, isGenerating),
      [blocks, isGenerating],
    );

    const workflowChromeComplete = !isGenerating || postToolTailPromoted;

    /** First non-placeholder in the answer column (pre-tool + post-tool when finalized). */
    const firstSubstantiveAnswerIndex = useMemo(
      () => answerBlocks.findIndex((b) => !isEmptyBlock(b)),
      [answerBlocks],
    );

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
          {workingBlocks.length > 0 && (
            <WorkflowCollapse
              assistantMessageId={id}
              blocks={workingBlocks}
              defaultStreamingExpanded={defaultWorkflowExpanded}
              disableEditing={disableEditing}
              workflowChromeComplete={workflowChromeComplete}
            />
          )}
          {answerBlocks.map((item, index) => {
            if (!isGenerating && isEmptyBlock(item)) return null;

            return (
              <GroupItem
                {...item}
                assistantId={id}
                contentId={contentId}
                disableEditing={disableEditing}
                key={id + '.' + item.id}
                messageIndex={messageIndex}
                isFirstBlock={
                  firstSubstantiveAnswerIndex >= 0 && index === firstSubstantiveAnswerIndex
                }
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
