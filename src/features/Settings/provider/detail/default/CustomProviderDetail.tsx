'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import ModelList from '../../features/ModelList';
import ProviderConfig from '../../features/ProviderConfig';

const CustomProviderDetail = memo<{ id: string }>(({ id }) => {
  const useFetchAiProviderItem = useAiInfraStore((s) => s.useFetchAiProviderItem);
  useFetchAiProviderItem(id);

  // Same replica entry the detail hook fills — no second fetch, and a reload
  // paints the cached provider while the network confirms it.
  const data = useAiInfraStore(aiProviderSelectors.providerDetailById(id));

  if (!data || !data.id) return <SurfaceSkeleton header={false} variant={'form'} />;

  return (
    // No block padding of its own — SettingContainer already insets the page.
    <Flexbox gap={24}>
      <ProviderConfig {...data} id={id} name={data.name || ''} />
      <ModelList id={id} />
    </Flexbox>
  );
});

export default CustomProviderDetail;
