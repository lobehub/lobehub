'use client';

import { Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { GithubProviderCard } from 'model-bank/modelProviders';
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

const providerKey: GlobalLLMProviderKey = 'github';

// Same as OpenAIProvider, but replace API Key with Github Personal Access Token
const useProviderCard = (): ProviderItem => {
  const { t } = useTranslation('modelProvider');
  const isLoading = useAiInfraStore(aiProviderSelectors.isAiProviderConfigLoading(providerKey));

  return {
    ...GithubProviderCard,
    apiKeyItems: [
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormPassword
            autoComplete={'new-password'}
            placeholder={t(`github.personalAccessToken.placeholder`)}
          />
        ),
        desc: (
          <Markdown className={styles.markdown} fontSize={12} variant={'chat'}>
            {t('github.personalAccessToken.desc')}
          </Markdown>
        ),
        label: t('github.personalAccessToken.title'),
        name: [KeyVaultsConfigKey, LLMProviderApiTokenKey],
      },
    ],
  };
};

const Page = () => {
  const card = useProviderCard();

  return <ProviderDetail {...card} />;
};

export default Page;
