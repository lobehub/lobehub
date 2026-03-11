import { memo } from 'react';

import { type FileListItem } from '@/types/files';

import MasonryFileItem from '.';

interface MasonryItemWrapperProps {
  context: {
    knowledgeBaseId?: string;
    selectFileIds: string[];
    setSelectedFileIds: (ids: string[]) => void;
  };
  data: FileListItem;
  index: number;
}

const MasonryItemWrapper = memo<MasonryItemWrapperProps>(({ data: item, context }) => {
  // Safety check: return null if item is undefined (can happen during deletion)
  if (!item || !item.id) {
    return null;
  }

  return (
    <div style={{ padding: '8px 4px' }}>
      <MasonryFileItem
        knowledgeBaseId={context.knowledgeBaseId}
        selected={context.selectFileIds.includes(item.id)}
        onSelectedChange={(id, checked) => {
          if (checked) {
            context.setSelectedFileIds([...context.selectFileIds, id]);
          } else {
            context.setSelectedFileIds(context.selectFileIds.filter((item) => item !== id));
          }
        }}
        {...item}
      />
    </div>
  );
});

MasonryItemWrapper.displayName = 'MasonryItemWrapper';

export default MasonryItemWrapper;
