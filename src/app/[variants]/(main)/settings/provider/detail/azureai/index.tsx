'use client';

import { ModelProvider } from 'model-bank';
import { AzureAIProviderCard } from 'model-bank/modelProviders';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import { SkeletonInput } from '@/components/Skeleton';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import { KeyVaultsConfigKey, LLMProviderApiTokenKey, LLMProviderBaseUrlKey } from '../../const';
import type {ProviderItem} from '../../type';
import ProviderDetail from '../default';

const providerKey = ModelProvider.AzureAI;

const useProviderCard = (): ProviderItem => {
  const { t } = useTranslation('modelProvider');

  const isLoading = useAiInfraStore(aiProviderSelectors.isAiProviderConfigLoading(providerKey));

  return {
    ...AzureAIProviderCard,
    apiKeyItems: [
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormPassword
            autoComplete={'new-password'}
            placeholder={t('azureai.token.placeholder')}
          />
        ),
        desc: t('azureai.token.desc'),
        label: t('azureai.token.title'),
        name: [KeyVaultsConfigKey, LLMProviderApiTokenKey],
      },
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormInput allowClear placeholder={t('azureai.endpoint.placeholder')} />
        ),
        desc: t('azureai.endpoint.desc'),
        label: t('azureai.endpoint.title'),
        name: [KeyVaultsConfigKey, LLMProviderBaseUrlKey],
      },
    ],
  };
};

const Page = () => {
  const card = useProviderCard();

  return <ProviderDetail {...card} />;
};

export default Page;
