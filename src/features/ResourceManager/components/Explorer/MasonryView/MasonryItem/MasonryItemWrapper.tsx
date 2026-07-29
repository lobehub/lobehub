import { memo } from 'react';

import { isExplorerItemSelected } from '@/routes/(main)/resource/features/store/selectors';
import { type FileListItem } from '@/types/files';

import MasonryFileItem from '.';

interface MasonryItemWrapperProps {
  context: {
    knowledgeBaseId?: string;
    isItemSelectable: (item: FileListItem) => boolean;
    onSelectedChange: (id: string, checked: boolean) => void;
    selectAllState: 'all' | 'loaded' | 'none';
    selectFileIds: string[];
  };
  data: FileListItem;
  index: number;
}

const MasonryItemWrapper = memo<MasonryItemWrapperProps>(({ data: item, context }) => {
  // Safety check: return null if item is undefined (can happen during deletion)
  if (!item || !item.id) {
    return null;
  }

  const selectable = context.isItemSelectable(item);

  return (
    <div style={{ padding: '8px 4px' }}>
      <MasonryFileItem
        knowledgeBaseId={context.knowledgeBaseId}
        selectable={selectable}
        selected={
          selectable &&
          isExplorerItemSelected({
            id: item.id,
            selectAllState: context.selectAllState,
            selectedIds: context.selectFileIds,
          })
        }
        onSelectedChange={context.onSelectedChange}
        {...item}
      />
    </div>
  );
});

MasonryItemWrapper.displayName = 'MasonryItemWrapper';

export default MasonryItemWrapper;
