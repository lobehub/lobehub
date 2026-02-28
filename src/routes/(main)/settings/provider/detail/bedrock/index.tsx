'use client';

import { Select } from '@lobehub/ui';
import { BedrockProviderCard } from 'model-bank/modelProviders';
import { useTranslation } from 'react-i18next';

import { FormPassword } from '@/components/FormInput';
import { SkeletonInput } from '@/components/Skeleton';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type GlobalLLMProviderKey } from '@/types/user/settings';

import { KeyVaultsConfigKey } from '../../const';
import { type ProviderItem } from '../../type';
import ProviderDetail from '../default';

const providerKey: GlobalLLMProviderKey = 'bedrock';

const AWS_REGIONS: string[] = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'us-gov-east-1',
  'us-gov-west-1',
  'sa-east-1',
  'eu-north-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-central-2',
  'eu-south-1',
  'eu-south-2',
  'me-south-1',
  'me-central-1',
  'af-south-1',
  'ap-south-1',
  'ap-south-2',
  'ap-east-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-southeast-4',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'cn-north-1',
  'cn-northwest-1',
];

const useBedrockCard = (): ProviderItem => {
  const { t } = useTranslation('modelProvider');

  const isLoading = useAiInfraStore(aiProviderSelectors.isAiProviderConfigLoading(providerKey));

  return {
    ...BedrockProviderCard,
    apiKeyItems: [
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormPassword
            autoComplete={'new-password'}
            placeholder={t(`${providerKey}.accessKeyId.placeholder`)}
          />
        ),
        desc: t(`${providerKey}.accessKeyId.desc`),
        label: t(`${providerKey}.accessKeyId.title`),
        name: [KeyVaultsConfigKey, 'accessKeyId'],
      },
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormPassword
            autoComplete={'new-password'}
            placeholder={t(`${providerKey}.secretAccessKey.placeholder`)}
          />
        ),
        desc: t(`${providerKey}.secretAccessKey.desc`),
        label: t(`${providerKey}.secretAccessKey.title`),
        name: [KeyVaultsConfigKey, 'secretAccessKey'],
      },
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormPassword
            autoComplete={'new-password'}
            placeholder={t(`${providerKey}.sessionToken.placeholder`)}
          />
        ),
        desc: t(`${providerKey}.sessionToken.desc`),
        label: t(`${providerKey}.sessionToken.title`),
        name: [KeyVaultsConfigKey, 'sessionToken'],
      },
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <Select
            allowClear
            placeholder={AWS_REGIONS[0]}
            options={AWS_REGIONS.map((i) => ({
              label: i,
              value: i,
            }))}
          />
        ),
        desc: t(`${providerKey}.region.desc`),
        label: t(`${providerKey}.region.title`),
        name: [KeyVaultsConfigKey, 'region'],
      },
    ],
  };
};

const Page = () => {
  const card = useBedrockCard();

  return <ProviderDetail {...card} />;
};

export default Page;
