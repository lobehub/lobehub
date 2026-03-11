'use client';

import { ComfyUI } from '@lobehub/icons';
import { Button, Center, Flexbox, Icon, Select } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Loader2Icon, Network } from 'lucide-react';
import { memo, use, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import KeyValueEditor from '@/components/KeyValueEditor';
import { FormAction } from '@/features/Conversation/Error/style';
import { useAiInfraStore } from '@/store/aiInfra';
import { type ComfyUIKeyVault } from '@/types/user/settings';

import { LoadingContext } from './LoadingContext';

interface ComfyUIFormProps {
  description: string;
}

const styles = createStaticStyles(({ css }) => ({
  comfyuiFormWide: css`
    max-width: 900px !important;

    /* Hide the avatar - target the first child which is the Avatar component */
    > *:first-child {
      display: none !important;
    }
  `,
  container: css`
    width: 100%;
    max-width: 900px;
    border: 1px solid ${cssVar.colorSplit};
    border-radius: 8px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
  `,
}));

const ComfyUIForm = memo<ComfyUIFormProps>(({ description }) => {
  const { t } = useTranslation('error');
  const { t: s } = useTranslation('modelProvider');

  // Use aiInfraStore for updating config (same as settings page)
  const updateAiProviderConfig = useAiInfraStore((s) => s.updateAiProviderConfig);
  const useFetchAiProviderRuntimeState = useAiInfraStore((s) => s.useFetchAiProviderRuntimeState);

  const { loading, setLoading } = use(LoadingContext);

  // Fetch the runtime state to ensure config is loaded
  // Pass true since this is for auth dialog (not initialization)
  const fetchRuntimeState = useFetchAiProviderRuntimeState(true);

  // Get ComfyUI config from aiInfraStore (same as settings page)
  const comfyUIConfig = useAiInfraStore(
    (s) => s.aiProviderRuntimeConfig?.['comfyui']?.keyVaults,
  ) as ComfyUIKeyVault | undefined;

  // State for showing base URL input - initially hidden
  const [showBaseURL, setShowBaseURL] = useState(false);

  // State management for form values - initialize without config first
  const [formValues, setFormValues] = useState({
    apiKey: '',
    authType: 'none' as string,
    baseURL: 'http://127.0.0.1:8000',
    customHeaders: {} as Record<string, string>,
    password: '',
    username: '',
  });

  // Update form values when comfyUIConfig changes (config read-back)
  // Use individual primitive values to avoid infinite re-renders
  useEffect(() => {
    if (comfyUIConfig) {
      const newValues = {
        apiKey: comfyUIConfig.apiKey || '',
        authType: comfyUIConfig.authType || 'none',
        baseURL: comfyUIConfig.baseURL || 'http://127.0.0.1:8000',
        customHeaders: comfyUIConfig.customHeaders || {},
        password: comfyUIConfig.password || '',
        username: comfyUIConfig.username || '',
      };
      setFormValues(newValues);
    }
  }, [
    comfyUIConfig?.apiKey,
    comfyUIConfig?.authType,
    comfyUIConfig?.baseURL,
    comfyUIConfig?.password,
    comfyUIConfig?.username,
    JSON.stringify(comfyUIConfig?.customHeaders),
  ]);

  const authTypeOptions = [
    { label: s('comfyui.authType.options.none'), value: 'none' },
    { label: s('comfyui.authType.options.basic'), value: 'basic' },
    { label: s('comfyui.authType.options.bearer'), value: 'bearer' },
    { label: s('comfyui.authType.options.custom'), value: 'custom' },
  ];

  const handleValueChange = async (field: string, value: any) => {
    const newValues = {
      ...formValues,
      [field]: value,
    };
    setFormValues(newValues);

    // Skip validation for certain fields that can be empty
    const skipValidation = ['customHeaders', 'apiKey', 'username', 'password'];

    // Basic validation before saving
    if (!skipValidation.includes(field) && field === 'baseURL' && !value) {
      return; // Don't save if baseURL is empty
    }

    // Real-time save like other providers
    setLoading(true);
    try {
      await updateAiProviderConfig('comfyui', {
        keyVaults: newValues,
      });
      // Refetch the runtime state to ensure config is synced
      await fetchRuntimeState.mutate();
    } catch (error) {
      console.error('Failed to update ComfyUI config:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Center className={styles.container} gap={24} padding={24}>
      <Center gap={16} paddingBlock={32} style={{ width: '100%' }}>
        <ComfyUI.Combine size={64} type={'color'} />
        <FormAction
          avatar={<div />}
          className={styles.comfyuiFormWide}
          description={description}
          title={t('unlock.comfyui.title', { name: 'ComfyUI' })}
        >
          <Flexbox gap={16} width="100%">
            {/* Base URL */}
            {showBaseURL ? (
              <Flexbox gap={4}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{s('comfyui.baseURL.title')}</div>
                <FormInput
                  placeholder={s('comfyui.baseURL.placeholder')}
                  suffix={<div>{loading && <Icon spin icon={Loader2Icon} />}</div>}
                  value={formValues.baseURL}
                  onChange={(value) => handleValueChange('baseURL', value)}
                />
              </Flexbox>
            ) : (
              <Button
                icon={<Icon icon={Network} />}
                type={'text'}
                onClick={() => setShowBaseURL(true)}
              >
                {t('unlock.comfyui.modifyBaseUrl')}
              </Button>
            )}

            {/* Auth Type */}
            <Flexbox gap={4}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{s('comfyui.authType.title')}</div>
              <Select
                allowClear={false}
                options={authTypeOptions}
                placeholder={s('comfyui.authType.placeholder')}
                value={formValues.authType}
                onChange={(value) => handleValueChange('authType', value)}
              />
            </Flexbox>

            {/* Basic Auth Fields */}
            {formValues.authType === 'basic' && (
              <>
                <Flexbox gap={4}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{s('comfyui.username.title')}</div>
                  <FormInput
                    autoComplete="username"
                    placeholder={s('comfyui.username.placeholder')}
                    suffix={<div>{loading && <Icon spin icon={Loader2Icon} />}</div>}
                    value={formValues.username}
                    onChange={(value) => handleValueChange('username', value)}
                  />
                </Flexbox>
                <Flexbox gap={4}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{s('comfyui.password.title')}</div>
                  <FormPassword
                    autoComplete="new-password"
                    placeholder={s('comfyui.password.placeholder')}
                    suffix={<div>{loading && <Icon spin icon={Loader2Icon} />}</div>}
                    value={formValues.password}
                    onChange={(value) => handleValueChange('password', value)}
                  />
                </Flexbox>
              </>
            )}

            {/* Bearer Token Field */}
            {formValues.authType === 'bearer' && (
              <Flexbox gap={4}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{s('comfyui.apiKey.title')}</div>
                <FormPassword
                  autoComplete="new-password"
                  placeholder={s('comfyui.apiKey.placeholder')}
                  suffix={<div>{loading && <Icon spin icon={Loader2Icon} />}</div>}
                  value={formValues.apiKey}
                  onChange={(value) => handleValueChange('apiKey', value)}
                />
              </Flexbox>
            )}

            {/* Custom Headers Field */}
            {formValues.authType === 'custom' && (
              <Flexbox gap={4}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {s('comfyui.customHeaders.title')}
                </div>
                <div style={{ color: cssVar.colorTextSecondary, fontSize: 12, marginBottom: 4 }}>
                  {s('comfyui.customHeaders.desc')}
                </div>
                <KeyValueEditor
                  addButtonText={s('comfyui.customHeaders.addButton')}
                  deleteTooltip={s('comfyui.customHeaders.deleteTooltip')}
                  duplicateKeyErrorText={s('comfyui.customHeaders.duplicateKeyError')}
                  keyPlaceholder={s('comfyui.customHeaders.keyPlaceholder')}
                  value={formValues.customHeaders}
                  valuePlaceholder={s('comfyui.customHeaders.valuePlaceholder')}
                  onChange={(value) => handleValueChange('customHeaders', value)}
                />
              </Flexbox>
            )}
          </Flexbox>
        </FormAction>
      </Center>
    </Center>
  );
});

ComfyUIForm.displayName = 'ComfyUIForm';

export default ComfyUIForm;
