'use client';

import { Select } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import KeyValueEditor from '@/components/KeyValueEditor';
import { ComfyUIProviderCard } from '@/config/modelProviders';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { GlobalLLMProviderKey } from '@/types/user/settings';

import { KeyVaultsConfigKey } from '../../const';
import { SkeletonInput } from '../../features/ProviderConfig';
import { ProviderItem } from '../../type';
import ProviderDetail from '../default';

const providerKey: GlobalLLMProviderKey = 'comfyui';

const useComfyUICard = (): ProviderItem => {
  const { t } = useTranslation('modelProvider');

  const isLoading = useAiInfraStore(aiProviderSelectors.isAiProviderConfigLoading(providerKey));

  // Get current config and watch for auth type changes
  const config = useAiInfraStore((s) => s.aiProviderRuntimeConfig?.[providerKey]);
  const authType = config?.keyVaults?.authType || 'none';

  const authTypeOptions = [
    { label: t('comfyui.authType.options.none'), value: 'none' },
    { label: t('comfyui.authType.options.basic'), value: 'basic' },
    { label: t('comfyui.authType.options.bearer'), value: 'bearer' },
    { label: t('comfyui.authType.options.custom'), value: 'custom' },
  ];

  const apiKeyItems = [
    // Base URL - Always shown
    {
      children: isLoading ? (
        <SkeletonInput />
      ) : (
        <FormInput placeholder={t('comfyui.baseURL.placeholder')} />
      ),
      desc: t('comfyui.baseURL.desc'),
      label: t('comfyui.baseURL.title'),
      name: [KeyVaultsConfigKey, 'baseURL'],
    },

    // Authentication Type Selector - Always shown
    {
      children: isLoading ? (
        <SkeletonInput />
      ) : (
        <Select
          allowClear={false}
          options={authTypeOptions}
          placeholder={t('comfyui.authType.placeholder')}
        />
      ),
      desc: t('comfyui.authType.desc'),
      label: t('comfyui.authType.title'),
      name: [KeyVaultsConfigKey, 'authType'],
    },
  ];

  // Conditionally add fields based on auth type
  if (authType === 'basic') {
    apiKeyItems.push(
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormInput autoComplete="username" placeholder={t('comfyui.username.placeholder')} />
        ),
        desc: t('comfyui.username.desc'),
        label: t('comfyui.username.title'),
        name: [KeyVaultsConfigKey, 'username'],
      },
      {
        children: isLoading ? (
          <SkeletonInput />
        ) : (
          <FormPassword
            autoComplete="new-password"
            placeholder={t('comfyui.password.placeholder')}
          />
        ),
        desc: t('comfyui.password.desc'),
        label: t('comfyui.password.title'),
        name: [KeyVaultsConfigKey, 'password'],
      },
    );
  }

  if (authType === 'bearer') {
    apiKeyItems.push({
      children: isLoading ? (
        <SkeletonInput />
      ) : (
        <FormPassword autoComplete="new-password" placeholder={t('comfyui.apiKey.placeholder')} />
      ),
      desc: t('comfyui.apiKey.desc'),
      label: t('comfyui.apiKey.title'),
      name: [KeyVaultsConfigKey, 'apiKey'],
    });
  }

  if (authType === 'custom') {
    apiKeyItems.push({
      children: isLoading ? (
        <SkeletonInput />
      ) : (
        <KeyValueEditor
          addButtonText={t('comfyui.customHeaders.addButton')}
          deleteTooltip={t('comfyui.customHeaders.deleteTooltip')}
          duplicateKeyErrorText={t('comfyui.customHeaders.duplicateKeyError')}
          keyPlaceholder={t('comfyui.customHeaders.keyPlaceholder')}
          valuePlaceholder={t('comfyui.customHeaders.valuePlaceholder')}
        />
      ),
      desc: t('comfyui.customHeaders.desc'),
      label: t('comfyui.customHeaders.title'),
      name: [KeyVaultsConfigKey, 'customHeaders'],
    });
  }

  return {
    ...ComfyUIProviderCard,
    apiKeyItems,
  };
};

const Page = () => {
  const card = useComfyUICard();

  return <ProviderDetail {...card} />;
};

export default Page;
