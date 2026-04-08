import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import { type AssistantContentBlock } from '@/types/index';

import WorkflowReasoningLine from './WorkflowReasoningLine';
import WorkflowToolLine from './WorkflowToolLine';

const styles = createStaticStyles(({ css }) => ({
  blockDivider: css`
    width: 100%;
    height: 1px;
    margin-block: 2px;
    background: ${cssVar.colorFillTertiary};
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
      <Flexbox gap={4} paddingBlock={'4px 8px'}>
        {blocks.map((block, index) => (
          <Flexbox key={block.id}>
            {index > 0 && blocks.length > 1 && <div className={styles.blockDivider} />}
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
