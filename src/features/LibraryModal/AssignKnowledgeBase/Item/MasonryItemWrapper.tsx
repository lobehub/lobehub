import { memo } from 'react';

import { type KnowledgeItem } from '@/types/knowledgeBase';

import MasonryItem from './MasonryItem';

interface MasonryItemWrapperProps {
  data: KnowledgeItem;
  index: number;
}

const MasonryItemWrapper = memo<MasonryItemWrapperProps>(({ data: item }) => {
  // Safety check: return null if item is undefined
  if (!item || !item.id) {
    return null;
  }

  return (
    <div style={{ padding: '8px 4px' }}>
      <MasonryItem {...item} />
    </div>
  );
});

MasonryItemWrapper.displayName = 'MasonryItemWrapper';

export default MasonryItemWrapper;
