'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { useAiInfraStore } from '@/store/aiInfra';
import { useServerConfigStore } from '@/store/serverConfig';

import ModelList from '../../features/ModelList';
import { type ProviderConfigProps } from '../../features/ProviderConfig';
import ProviderConfig from '../../features/ProviderConfig';

interface ProviderDetailProps extends ProviderConfigProps {
  showConfig?: boolean;
}
const ProviderDetail = memo<ProviderDetailProps>(({ showConfig = true, ...card }) => {
  const useFetchAiProviderItem = useAiInfraStore((s) => s.useFetchAiProviderItem);
  const useFetchAiProviderList = useAiInfraStore((s) => s.useFetchAiProviderList);
  const isMobile = useServerConfigStore((s) => s.isMobile);

  const { data: managedStatus } = useClientDataSWR('aico-provider-status', () =>
    lambdaClient.aicoBilling.getManagedProviderStatus.query(),
  );
  const aicoManaged = Boolean(managedStatus?.managed);
  // Managed Aico traffic hides BYOK config so users never see/edit OpenRouter secrets.
  const hideKeyConfig = aicoManaged && (card.id === 'openrouter' || card.id === 'aico');

  useFetchAiProviderList({ enabled: isMobile });
  useFetchAiProviderItem(card.id);

  return (
    <Flexbox gap={24} paddingBlock={8}>
      {showConfig && !hideKeyConfig && <ProviderConfig {...card} />}
      <ModelList id={card.id} {...card.settings} />
    </Flexbox>
  );
});

export default ProviderDetail;
