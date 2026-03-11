import { ModelIcon } from '@lobehub/icons';
import { Flexbox, SortableList } from '@lobehub/ui';
import { type AiProviderModelListItem } from 'model-bank';
import { memo } from 'react';

const ListItem = memo<AiProviderModelListItem>(({ id, displayName }) => {
  return (
    <>
      <Flexbox horizontal gap={8}>
        <ModelIcon model={id} size={24} type={'avatar'} />
        {displayName || id}
      </Flexbox>
      <SortableList.DragHandle />
    </>
  );
});

export default ListItem;
