import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type RefObject } from 'react';

import { type AssistantContentBlock } from '@/types/index';

import WorkflowReasoningLine from './WorkflowReasoningLine';
import WorkflowToolLine from './WorkflowToolLine';

const styles = createStaticStyles(({ css }) => ({
  blockContent: css`
    padding-block: 3px;
    padding-inline: 32px 8px;
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface WorkflowExpandedListProps {
  blocks: AssistantContentBlock[];
  constrained?: boolean;
  disableEditing?: boolean;
  onScroll?: () => void;
  scrollRef?: RefObject<HTMLDivElement | null>;
}

const WorkflowExpandedList = memo<WorkflowExpandedListProps>(
  ({ blocks, disableEditing, constrained, scrollRef, onScroll }) => {
    const content = (
      <Flexbox paddingBlock={'4px 8px'}>
        {blocks.map((block) => (
          <Flexbox key={block.id}>
            {block.content && <div className={styles.blockContent}>{block.content}</div>}
            {block.reasoning && <WorkflowReasoningLine id={block.id} reasoning={block.reasoning} />}
            {block.tools?.map((tool) => (
              <WorkflowToolLine
                assistantMessageId={block.id}
                disableEditing={disableEditing}
                key={tool.id}
                tool={tool}
              />
            ))}
          </Flexbox>
        ))}
      </Flexbox>
    );

    if (constrained) {
      return (
        <ScrollShadow
          offset={12}
          ref={scrollRef as RefObject<HTMLDivElement>}
          size={12}
          style={{ maxHeight: 'min(40vh, 320px)' }}
          onScroll={onScroll}
        >
          {content}
        </ScrollShadow>
      );
    }

    return content;
  },
);

WorkflowExpandedList.displayName = 'WorkflowExpandedList';

export default WorkflowExpandedList;
