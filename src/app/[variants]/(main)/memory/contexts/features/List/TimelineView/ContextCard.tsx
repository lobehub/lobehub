import { memo } from 'react';

import TimeLineCard from '@/app/[variants]/(main)/memory/features/TimeLineView/TimeLineCard';
import { type DisplayContextMemory } from '@/database/repositories/userMemory';

import ContextDropdown from '../../ContextDropdown';

interface ContextCardProps {
  context: DisplayContextMemory;
  onClick?: () => void;
}

const ContextCard = memo<ContextCardProps>(({ context, onClick }) => {
  return (
    <TimeLineCard
      actions={<ContextDropdown id={context.id} />}
      capturedAt={context.capturedAt || context.updatedAt || context.createdAt}
      cate={context.type}
      hashTags={context.tags}
      title={context.title}
      onClick={onClick}
    >
      {context.description}
    </TimeLineCard>
  );
});

export default ContextCard;
