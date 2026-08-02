import { Flexbox, SortableList } from '@lobehub/ui';
import { type AiProviderModelListItem } from 'model-bank';
import { memo } from 'react';

import { BrandedModelIcon } from '@/components/Branding';

interface ListItemProps extends AiProviderModelListItem {
  disabled?: boolean;
}

const ListItem = memo<ListItemProps>(({ id, displayName, disabled }) => {
  return (
    <>
      <Flexbox horizontal gap={8}>
        <BrandedModelIcon model={id} size={24} type={'avatar'} />
        {displayName || id}
      </Flexbox>
      {!disabled && <SortableList.DragHandle />}
    </>
  );
});

export default ListItem;
