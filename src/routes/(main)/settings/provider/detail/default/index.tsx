'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { useAiInfraStore } from '@/store/aiInfra';
import { useServerConfigStore } from '@/store/serverConfig';

import ModelList from '../../features/ModelList';
import { type ProviderConfigProps } from '../../features/ProviderConfig';
import ProviderConfig from '../../features/ProviderConfig';
import AicoManagedProviderHeader from './AicoManagedProviderHeader';

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
  const aicoManaged = managedStatus?.managed ?? true;
  // Managed Aico: branded panel only — never surface BYOK secrets or OpenRouter chrome.
  const isManagedAico = aicoManaged && (card.id === 'openrouter' || card.id === 'aico');

  const managedSettings = useMemo(() => {
    if (!isManagedAico) return card.settings;
    return {
      ...card.settings,
      disableBrowserRequest: true,
      proxyUrl: undefined,
      showApiKey: false,
      showChecker: false,
      showModelFetcher: false,
    };
  }, [card.settings, isManagedAico]);

  useFetchAiProviderList({ enabled: isMobile || isManagedAico });
  useFetchAiProviderItem(card.id);

  return (
    // No block padding of its own — SettingContainer already insets the page.
    <Flexbox gap={24}>
      {showConfig &&
        (isManagedAico ? (
          <AicoManagedProviderHeader />
        ) : (
          <ProviderConfig {...card} settings={managedSettings} />
        ))}
      <ModelList
        id={card.id}
        modelEditable={!isManagedAico}
        showAddNewModel={!isManagedAico}
        {...managedSettings}
      />
    </Flexbox>
  );
});

export default ProviderDetail;
