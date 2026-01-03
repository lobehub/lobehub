import { ModelIcon } from '@lobehub/icons';
import { Flexbox, SortableList } from '@lobehub/ui';
import { type AiProviderModelListItem } from 'model-bank';
import { memo } from 'react';

const ListItem = memo<AiProviderModelListItem>(({ id, displayName }) => {
  return (
    <>
      <Flexbox gap={8} horizontal>
        <ModelIcon model={id} size={24} type={'avatar'} />
        {displayName || id}
      </Flexbox>
      <SortableList.DragHandle />
    </>
  );
});

export default ListItem;
