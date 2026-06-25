'use client';

import { Select } from '@lobehub/ui';
import { Tabs, type TabsItem } from '@lobehub/ui/base-ui';
import { BedrockProviderCard } from 'model-bank/modelProviders';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormPassword } from '@/components/FormInput';
import { SkeletonInput } from '@/components/Skeleton';
import { usePermission } from '@/hooks/usePermission';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type GlobalLLMProviderKey } from '@/types/user/settings';
import {
  BedrockAuthMode,
  inferBedrockAuthMode,
  normalizeBedrockConfigValues,
  normalizeBedrockKeyVaultsForAuthMode,
} from '@/utils/bedrockAuthMode';

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
  const { allowed: canManageProvider } = usePermission('manage_provider_key');

  const isLoading = useAiInfraStore(aiProviderSelectors.isAiProviderConfigLoading(providerKey));
  const keyVaults = useAiInfraStore(aiProviderSelectors.providerKeyVaults(providerKey));
  const updateAiProviderConfig = useAiInfraStore((s) => s.updateAiProviderConfig);

  const [authMode, setAuthMode] = useState(() => inferBedrockAuthMode(keyVaults));

  useEffect(() => {
    if (isLoading) return;

    const hasAuthShape = !!(
      keyVaults?.accessKeyId ||
      keyVaults?.apiKey ||
      keyVaults?.secretAccessKey
    );

    if (!hasAuthShape) return;

    setAuthMode(inferBedrockAuthMode(keyVaults));
  }, [isLoading, keyVaults?.accessKeyId, keyVaults?.apiKey, keyVaults?.secretAccessKey]);

  const authModeOptions = useMemo<TabsItem[]>(
    () => [
      {
        disabled: !canManageProvider,
        key: BedrockAuthMode.ApiKey,
        label: t(`${providerKey}.authMode.options.apiKey`),
      },
      {
        disabled: !canManageProvider,
        key: BedrockAuthMode.AwsCredentials,
        label: t(`${providerKey}.authMode.options.awsCredentials`),
      },
    ],
    [canManageProvider, t],
  );

  const handleAuthModeChange = useCallback(
    (mode: string) => {
      if (!canManageProvider) return;

      const nextMode = mode as BedrockAuthMode;

      setAuthMode(nextMode);
      void updateAiProviderConfig(providerKey, {
        keyVaults: normalizeBedrockKeyVaultsForAuthMode(nextMode),
      });
    },
    [canManageProvider, updateAiProviderConfig],
  );

  const apiKeyItem = {
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
    preserve: false,
  };

  const awsCredentialItems = [
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
      preserve: false,
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
      preserve: false,
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
      preserve: false,
    },
  ];

  return {
    ...BedrockProviderCard,
    apiKeyItems: [
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <Tabs
            activeKey={authMode}
            items={authModeOptions}
            styles={{
              list: { display: 'flex', width: '100%' },
              tab: { flex: 1 },
            }}
            onChange={handleAuthModeChange}
          />
        ),
        desc: t(`${providerKey}.authMode.desc`),
        label: t(`${providerKey}.authMode.title`),
      },
      ...(authMode === BedrockAuthMode.ApiKey ? [apiKeyItem] : awsCredentialItems),
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
    normalizeConfigValues: normalizeBedrockConfigValues(authMode),
  };
};

const Page = () => {
  const card = useBedrockCard();

  return <ProviderDetail {...card} />;
};

export default Page;
