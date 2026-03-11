'use client';

import { AutoComplete, Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ModelProvider } from 'model-bank';
import { AzureProviderCard } from 'model-bank/modelProviders';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import { SkeletonInput } from '@/components/Skeleton';
import { aiModelSelectors, aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import { KeyVaultsConfigKey, LLMProviderApiTokenKey, LLMProviderBaseUrlKey } from '../../const';
import { type ProviderItem } from '../../type';
import ProviderDetail from '../default';

const styles = createStaticStyles(({ css, cssVar }) => ({
  markdown: css`
    p {
      color: ${cssVar.colorTextDescription} !important;
    }
  `,
  tip: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
}));

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
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <AutoComplete
            placeholder={'20XX-XX-XX'}
            options={[
              '2024-10-21',
              '2024-06-01',
              '2025-01-01-preview',
              '2024-09-01-preview',
              '2024-10-01-preview',
            ].map((i) => ({ label: i, value: i }))}
          />
        ),
        desc: (
          <Markdown className={styles.markdown} fontSize={12} variant={'chat'}>
            {t('azure.azureApiVersion.desc')}
          </Markdown>
        ),
        label: t('azure.azureApiVersion.title'),
        name: [KeyVaultsConfigKey, 'apiVersion'],
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
