'use client';

import { CloudflareProviderCard } from 'model-bank/modelProviders';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import { SkeletonInput } from '@/components/Skeleton';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import type {GlobalLLMProviderKey} from '@/types/user/settings';

import { KeyVaultsConfigKey } from '../../const';
import type {ProviderItem} from '../../type';
import ProviderDetail from '../default';

const providerKey: GlobalLLMProviderKey = 'cloudflare';

const useProviderCard = (): ProviderItem => {
  const { t } = useTranslation('modelProvider');

  const isLoading = useAiInfraStore(aiProviderSelectors.isAiProviderConfigLoading(providerKey));

  return {
    ...CloudflareProviderCard,
    apiKeyItems: [
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormPassword
            autoComplete={'new-password'}
            placeholder={t(`${providerKey}.apiKey.placeholder`)}
          />
        ),
        desc: t(`${providerKey}.apiKey.desc`),
        label: t(`${providerKey}.apiKey.title`),
        name: [KeyVaultsConfigKey, 'apiKey'],
      },
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormInput placeholder={t(`${providerKey}.baseURLOrAccountID.placeholder`)} />
        ),
        desc: t(`${providerKey}.baseURLOrAccountID.desc`),
        label: t(`${providerKey}.baseURLOrAccountID.title`),
        name: [KeyVaultsConfigKey, 'baseURLOrAccountID'],
      },
    ],
  };
};

const Page = () => {
  const card = useProviderCard();

  return <ProviderDetail {...card} />;
};

export default Page;
