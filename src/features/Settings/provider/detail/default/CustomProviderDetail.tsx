'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import { useClientDataSWR } from '@/libs/swr';
import { providerKeys } from '@/libs/swr/keys';
import { aiProviderService } from '@/services/aiProvider';
import { useAiInfraStore } from '@/store/aiInfra';

import ModelList from '../../features/ModelList';
import ProviderConfig from '../../features/ProviderConfig';

const CustomProviderDetail = memo<{ id: string }>(({ id }) => {
  const useFetchAiProviderItem = useAiInfraStore((s) => s.useFetchAiProviderItem);
  useFetchAiProviderItem(id);

  const { data, isLoading } = useClientDataSWR(providerKeys.clientConfig(id), () =>
    aiProviderService.getAiProviderById(id),
  );

  if (isLoading || !data || !data.id) return <SurfaceSkeleton header={false} variant={'form'} />;

  return (
    // No block padding of its own — SettingContainer already insets the page.
    <Flexbox gap={24}>
      <ProviderConfig {...data} id={id} name={data.name || ''} />
      <ModelList id={id} />
    </Flexbox>
  );
});

export default CustomProviderDetail;
