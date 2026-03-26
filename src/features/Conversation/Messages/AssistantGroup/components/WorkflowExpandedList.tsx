import { memo } from 'react';

import { type AssistantContentBlock } from '@/types/index';

import ContentBlock from './ContentBlock';

interface WorkflowExpandedListProps {
  assistantId: string;
  blocks: AssistantContentBlock[];
  disableEditing?: boolean;
}

const WorkflowExpandedList = memo<WorkflowExpandedListProps>(
  ({ blocks, assistantId, disableEditing }) => {
    return (
      <>
        {blocks.map((block) => (
          <ContentBlock
            {...block}
            assistantId={assistantId}
            disableEditing={disableEditing}
            key={block.id}
          />
        ))}
      </>
    );
  },
);

WorkflowExpandedList.displayName = 'WorkflowExpandedList';

export default WorkflowExpandedList;
