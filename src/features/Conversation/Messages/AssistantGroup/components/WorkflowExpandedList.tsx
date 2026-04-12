import { memo, type RefObject } from 'react';

import type { AssistantContentBlock } from '@/types/index';

import ContentBlocksScroll from './ContentBlocksScroll';

interface WorkflowExpandedListProps {
  assistantId: string;
  blocks: AssistantContentBlock[];
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
