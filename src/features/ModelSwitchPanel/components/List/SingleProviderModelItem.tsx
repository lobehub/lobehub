import { memo } from 'react';

import { ModelItemRender } from '@/components/ModelSelect';

import { type ModelWithProviders } from '../../types';

interface SingleProviderModelItemProps {
  data: ModelWithProviders;
  newLabel: string;
}

export const SingleProviderModelItem = memo<SingleProviderModelItemProps>(({ data, newLabel }) => {
  return (
    <ModelItemRender
      {...data.model}
      {...data.model.abilities}
      newBadgeLabel={newLabel}
      showInfoTag={true}
    />
  );
});

SingleProviderModelItem.displayName = 'SingleProviderModelItem';
