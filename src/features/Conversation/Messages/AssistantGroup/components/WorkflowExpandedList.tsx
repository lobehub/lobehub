import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import { type AssistantContentBlock } from '@/types/index';

import WorkflowReasoningLine from './WorkflowReasoningLine';
import WorkflowToolLine from './WorkflowToolLine';

const styles = createStaticStyles(({ css }) => ({
  blockContent: css`
    padding-block: 2px;
    padding-inline: 30px 8px;
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface WorkflowExpandedListProps {
  assistantId: string;
  blocks: AssistantContentBlock[];
  disableEditing?: boolean;
}

const WorkflowExpandedList = memo<WorkflowExpandedListProps>(
  ({ blocks, assistantId, disableEditing }) => {
    return (
      <Flexbox paddingBlock={'4px 8px'}>
        {blocks.map((block) => (
          <Flexbox key={block.id}>
            {block.content && <div className={styles.blockContent}>{block.content}</div>}
            {block.reasoning && <WorkflowReasoningLine reasoning={block.reasoning} />}
            {block.tools?.map((tool) => (
              <WorkflowToolLine
                assistantMessageId={assistantId}
                blockMessageId={block.id}
                disableEditing={disableEditing}
                key={tool.id}
                tool={tool}
              />
            ))}
          </Flexbox>
        ))}
      </Flexbox>
    );
  },
);

WorkflowExpandedList.displayName = 'WorkflowExpandedList';

export default WorkflowExpandedList;
