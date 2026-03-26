import { memo } from 'react';

import { type AssistantContentBlock } from '@/types/index';

import WorkflowReasoningLine from './WorkflowReasoningLine';
import WorkflowToolLine from './WorkflowToolLine';

interface WorkflowExpandedListProps {
  assistantId: string;
  blocks: AssistantContentBlock[];
  disableEditing?: boolean;
}

const WorkflowExpandedList = memo<WorkflowExpandedListProps>(
  ({ blocks, assistantId, disableEditing }) => {
    return (
      <div>
        {blocks.map((block) => (
          <div key={block.id}>
            {block.reasoning && <WorkflowReasoningLine reasoning={block.reasoning} />}
            {block.tools?.map((tool) => (
              <WorkflowToolLine
                assistantMessageId={assistantId}
                disableEditing={disableEditing}
                key={tool.id}
                tool={tool}
              />
            ))}
          </div>
        ))}
      </div>
    );
  },
);

WorkflowExpandedList.displayName = 'WorkflowExpandedList';

export default WorkflowExpandedList;
