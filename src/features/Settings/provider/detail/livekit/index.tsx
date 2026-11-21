'use client';

import { LiveKitProviderCard } from 'model-bank/modelProviders';
import { useTranslation } from 'react-i18next';

import { FormPassword } from '@/components/FormInput';
import { SkeletonInput } from '@/components/Skeleton';
import { usePermission } from '@/hooks/usePermission';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import { KeyVaultsConfigKey } from '../../const';
import ProviderDetail from '../default';

const Page = () => {
  const { t } = useTranslation('modelProvider');
  const { allowed: canManageProvider } = usePermission('manage_provider_key');
  const isLoading = useAiInfraStore(aiProviderSelectors.isAiProviderConfigLoading('livekit'));

  const apiKeyItems = (['apiKey', 'apiSecret'] as const).map((field) => ({
    children: isLoading ? (
      <SkeletonInput />
    ) : (
      <FormPassword
        autoComplete={'new-password'}
        disabled={!canManageProvider}
        placeholder={t(`livekit.${field}.placeholder`)}
      />
    ),
    desc: t(`livekit.${field}.desc`),
    label: t(`livekit.${field}.title`),
    name: `${KeyVaultsConfigKey}.${field}`,
  }));

  return <ProviderDetail {...LiveKitProviderCard} apiKeyItems={apiKeyItems} />;
};

export default Page;
