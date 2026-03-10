import { memo } from 'react';

import { ModelItemRender } from '@/components/ModelSelect';

import { type ModelWithProviders } from '../../types';

interface SingleProviderModelItemProps {
  data: ModelWithProviders;
  newLabel: string;
  proBadgeLabel?: string;
}

export const SingleProviderModelItem = memo<SingleProviderModelItemProps>(
  ({ data, newLabel, proBadgeLabel }) => {
    return (
      <ModelItemRender
        {...data.model}
        {...data.model.abilities}
        newBadgeLabel={newLabel}
        proBadgeLabel={proBadgeLabel}
        showInfoTag={true}
      />
    );
  },
);

SingleProviderModelItem.displayName = 'SingleProviderModelItem';
