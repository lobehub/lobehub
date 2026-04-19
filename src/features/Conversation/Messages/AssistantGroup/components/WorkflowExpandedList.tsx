import { memo, type RefObject } from 'react';

import ContentBlocksScroll from './ContentBlocksScroll';
import type { RenderableAssistantContentBlock } from './types';

interface WorkflowExpandedListProps {
  assistantId: string;
  blocks: RenderableAssistantContentBlock[];
  constrained?: boolean;
  disableEditing?: boolean;
  onScroll?: () => void;
  scrollRef?: RefObject<HTMLDivElement | null>;
}

const WorkflowExpandedList = memo<WorkflowExpandedListProps>(
  ({ assistantId, blocks, constrained, disableEditing, onScroll, scrollRef }) => (
    <ContentBlocksScroll
      assistantId={assistantId}
      blocks={blocks}
      disableEditing={disableEditing}
      scroll={!!constrained}
      scrollRef={scrollRef}
      variant="workflow"
      onScroll={onScroll}
    />
  ),
);

WorkflowExpandedList.displayName = 'WorkflowExpandedList';

export default WorkflowExpandedList;
