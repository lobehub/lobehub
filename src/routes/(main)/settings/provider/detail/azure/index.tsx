'use client';

import { ModelProvider } from 'model-bank';
import { AzureProviderCard } from 'model-bank/modelProviders';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import { SkeletonInput } from '@/components/Skeleton';
import { aiModelSelectors, aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import { KeyVaultsConfigKey, LLMProviderApiTokenKey, LLMProviderBaseUrlKey } from '../../const';
import { type ProviderItem } from '../../type';
import ProviderDetail from '../default';

const providerKey = ModelProvider.Azure;

const useProviderCard = (): ProviderItem => {
  const { t } = useTranslation('modelProvider');

  // Get the first model card's deployment name as the check model
  const checkModel = useAiInfraStore((s) => {
    const modelList = aiModelSelectors.enabledAiProviderModelList(s);

    if (modelList.length > 0) {
      return modelList[0].id;
    }

    return 'gpt-35-turbo';
  });

  const isLoading = useAiInfraStore(aiProviderSelectors.isAiProviderConfigLoading(providerKey));

  return {
    ...AzureProviderCard,
    apiKeyItems: [
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormPassword autoComplete={'new-password'} placeholder={t('azure.token.placeholder')} />
        ),
        desc: t('azure.token.desc'),
        label: t('azure.token.title'),
        name: [KeyVaultsConfigKey, LLMProviderApiTokenKey],
      },
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormInput allowClear placeholder={t('azure.endpoint.placeholder')} />
        ),
        desc: t('azure.endpoint.desc'),
        label: t('azure.endpoint.title'),
        name: [KeyVaultsConfigKey, LLMProviderBaseUrlKey],
      },
    ],
    checkModel,
    modelList: {
      azureDeployName: true,
      notFoundContent: t('azure.empty'),
      placeholder: t('azure.modelListPlaceholder'),
    },
  };
};

const Page = () => {
  const card = useProviderCard();

  return <ProviderDetail {...card} />;
};

export default Page;
