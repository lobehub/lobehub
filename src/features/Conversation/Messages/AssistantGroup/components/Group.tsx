import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import { type AssistantContentBlock } from '@/types/index';

import { messageStateSelectors, useConversationStore } from '../../../store';
import { MessageAggregationContext } from '../../Contexts/MessageAggregationContext';
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
  disableEditing?: boolean;
  id: string;
  messageIndex: number;
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

/**
 * Partition blocks into "working phase" and "answer phase".
 *
 * Working phase: from first block with tools through last block with tools
 * (inclusive — interleaved content/reasoning blocks between tool blocks are included).
 *
 * Answer phase: all blocks after the last tool block.
 * Blocks before the first tool block are also treated as answer (pre-content).
 */
const partitionBlocks = (
  blocks: AssistantContentBlock[],
): { answerBlocks: AssistantContentBlock[]; workingBlocks: AssistantContentBlock[] } => {
  let lastToolIndex = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (hasTools(blocks[i])) {
      lastToolIndex = i;
      break;
    }
  }

  if (lastToolIndex === -1) {
    return { answerBlocks: blocks, workingBlocks: [] };
  }

  let firstToolIndex = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (hasTools(blocks[i])) {
      firstToolIndex = i;
      break;
    }
  }

  const preBlocks = blocks.slice(0, firstToolIndex);
  const workingBlocks = blocks.slice(firstToolIndex, lastToolIndex + 1);
  const answerBlocks = blocks.slice(lastToolIndex + 1);

  return {
    answerBlocks: [...preBlocks, ...answerBlocks],
    workingBlocks,
  };
};

const Group = memo<GroupChildrenProps>(
  ({ blocks, contentId, disableEditing, messageIndex, id, content }) => {
    const [isCollapsed, isGenerating] = useConversationStore((s) => [
      messageStateSelectors.isMessageCollapsed(id)(s),
      messageStateSelectors.isMessageGenerating(id)(s),
    ]);
    const contextValue = useMemo(() => ({ assistantGroupId: id }), [id]);

    const { workingBlocks, answerBlocks } = useMemo(() => partitionBlocks(blocks), [blocks]);

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
              disableEditing={disableEditing}
              hasBlocksOutsideWorkflow={answerBlocks.length > 0}
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
                isFirstBlock={index === 0}
                key={id + '.' + item.id}
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
