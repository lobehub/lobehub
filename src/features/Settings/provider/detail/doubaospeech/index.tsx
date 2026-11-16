'use client';

import { Flexbox } from '@lobehub/ui';
import { DoubaoSpeechProviderCard } from 'model-bank/modelProviders';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import { ProviderIcon } from '@/components/LobeIcons';
import { SkeletonInput } from '@/components/Skeleton';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type GlobalLLMProviderKey } from '@/types/user/settings';

import { KeyVaultsConfigKey } from '../../const';
import { type ProviderItem } from '../../type';
import ProviderDetail from '../default';

const providerKey: GlobalLLMProviderKey = 'doubaospeech';

/**
 * Doubao Speech accepts either console's credentials: the new console's API key, or the
 * legacy console's App ID + Access Token. The runtime prefers the API key.
 */
const useProviderCard = (): ProviderItem => {
  const { t } = useTranslation('modelProvider');

  const isLoading = useAiInfraStore(aiProviderSelectors.isAiProviderConfigLoading(providerKey));

  return {
    ...DoubaoSpeechProviderCard,
    // The Doubao combined logo reads 豆包大模型 (the Ark chat models), so show the
    // Doubao mark with this provider's own name instead.
    title: (
      <Flexbox horizontal align={'center'} gap={8}>
        <ProviderIcon
          provider={providerKey}
          shape={'square'}
          size={24}
          style={{ borderRadius: 6 }}
          type={'avatar'}
        />
        {DoubaoSpeechProviderCard.name}
      </Flexbox>
    ),
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
        name: `${KeyVaultsConfigKey}.apiKey`,
      },
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormInput allowClear placeholder={t(`${providerKey}.appId.placeholder`)} />
        ),
        desc: t(`${providerKey}.appId.desc`),
        label: t(`${providerKey}.appId.title`),
        name: `${KeyVaultsConfigKey}.appId`,
      },
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormPassword
            autoComplete={'new-password'}
            placeholder={t(`${providerKey}.accessToken.placeholder`)}
          />
        ),
        desc: t(`${providerKey}.accessToken.desc`),
        label: t(`${providerKey}.accessToken.title`),
        name: `${KeyVaultsConfigKey}.accessToken`,
      },
    ],
  };
};

const Page = () => {
  const card = useProviderCard();

  return <ProviderDetail {...card} />;
};

export default Page;
