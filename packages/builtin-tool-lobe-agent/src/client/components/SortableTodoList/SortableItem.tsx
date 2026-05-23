'use client';

import { SortableList } from '@lobehub/ui';
import { memo } from 'react';

import TodoItemRow from './TodoItemRow';

interface SortableItemProps {
  id: string;
  placeholder?: string;
}

const SortableItem = memo<SortableItemProps>(({ id, placeholder }) => {
  return (
    <SortableList.Item id={id} style={{ padding: 0 }}>
      <TodoItemRow id={id} placeholder={placeholder} />
    </SortableList.Item>
  );
});

SortableItem.displayName = 'SortableItem';

export default SortableItem;
