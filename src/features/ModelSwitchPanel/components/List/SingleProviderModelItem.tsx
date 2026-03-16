import { memo } from 'react';

import { ModelItemRender } from '@/components/ModelSelect';

import { type ModelWithProviders } from '../../types';

interface SingleProviderModelItemProps {
  data: ModelWithProviders;
  newLabel: string;
  proBadgeLabel?: string;
  showInfoTag?: boolean;
}

export const SingleProviderModelItem = memo<SingleProviderModelItemProps>(
  ({ data, newLabel, proBadgeLabel, showInfoTag }) => {
    return (
      <ModelItemRender
        {...data.model}
        {...data.model.abilities}
        newBadgeLabel={newLabel}
        proBadgeLabel={proBadgeLabel}
        showInfoTag={showInfoTag}
      />
    );
  },
);

SingleProviderModelItem.displayName = 'SingleProviderModelItem';
