'use client';

import { Markdown, Select } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { VertexAIProviderCard } from 'model-bank/modelProviders';
import { useTranslation } from 'react-i18next';

import { FormPassword } from '@/components/FormInput';
import { SkeletonInput } from '@/components/Skeleton';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type GlobalLLMProviderKey } from '@/types/user/settings';

import { KeyVaultsConfigKey, LLMProviderApiTokenKey } from '../../const';
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

const providerKey: GlobalLLMProviderKey = 'vertexai';

const VERTEX_AI_REGIONS: string[] = [
  'global',
  'us-central1',
  'us-east1',
  'us-east4',
  'us-west1',
  'us-west2',
  'us-west3',
  'us-west4',
  'us-south1',
  'northamerica-northeast1',
  'northamerica-northeast2',
  'southamerica-east1',
  'southamerica-west1',
  'europe-central2',
  'europe-north1',
  'europe-southwest1',
  'europe-west1',
  'europe-west2',
  'europe-west3',
  'europe-west4',
  'europe-west6',
  'europe-west8',
  'europe-west9',
  'europe-west10',
  'europe-west12',
  'me-central1',
  'me-central2',
  'me-west1',
  'africa-south1',
  'asia-east1',
  'asia-east2',
  'asia-northeast1',
  'asia-northeast2',
  'asia-northeast3',
  'asia-south1',
  'asia-southeast1',
  'asia-southeast2',
  'australia-southeast1',
  'australia-southeast2',
];

// Same as OpenAIProvider, but replace API Key with HuggingFace Access Token
const useProviderCard = (): ProviderItem => {
  const { t } = useTranslation('modelProvider');
  const isLoading = useAiInfraStore(aiProviderSelectors.isAiProviderConfigLoading(providerKey));

  return {
    ...VertexAIProviderCard,
    apiKeyItems: [
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormPassword
            autoComplete={'new-password'}
            placeholder={t('vertexai.apiKey.placeholder')}
          />
        ),
        desc: (
          <Markdown className={styles.markdown} fontSize={12} variant={'chat'}>
            {t('vertexai.apiKey.desc')}
          </Markdown>
        ),
        label: t('vertexai.apiKey.title'),
        name: [KeyVaultsConfigKey, LLMProviderApiTokenKey],
      },
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <Select
            allowClear
            placeholder={t('vertexai.region.placeholder')}
            options={VERTEX_AI_REGIONS.map((region) => ({
              label: region,
              value: region,
            }))}
          />
        ),
        desc: (
          <Markdown className={styles.markdown} fontSize={12} variant={'chat'}>
            {t('vertexai.region.desc')}
          </Markdown>
        ),
        label: t('vertexai.region.title'),
        name: [KeyVaultsConfigKey, 'region'],
      },
    ],
  };
};

const Page = () => {
  const card = useProviderCard();

  return <ProviderDetail {...card} />;
};

export default Page;
