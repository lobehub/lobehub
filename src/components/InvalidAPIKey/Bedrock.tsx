import { Aws } from '@lobehub/icons';
import { Button, Icon, InputPassword, Select } from '@lobehub/ui';
import { Tabs, type TabsItem } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Network, ShieldPlus } from 'lucide-react';
import { ModelProvider } from 'model-bank';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormAction } from '@/features/Conversation/Error/style';
import { usePermission } from '@/hooks/usePermission';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import {
  BedrockAuthMode,
  inferBedrockAuthMode,
  normalizeBedrockKeyVaultsForAuthMode,
} from '@/utils/bedrockAuthMode';

const BedrockForm = memo<{ description: string }>(({ description }) => {
  const { t } = useTranslation('modelProvider');
  const { allowed: canManageProvider } = usePermission('manage_provider_key');
  const [showRegion, setShow] = useState(false);
  const [showSessionToken, setShowSessionToken] = useState(false);

  const config = useAiInfraStore(aiProviderSelectors.providerKeyVaults(ModelProvider.Bedrock));
  const setConfig = useAiInfraStore((s) => s.updateAiProviderConfig);
  const { accessKeyId, apiKey, secretAccessKey, sessionToken, region } = config || {};

  const [authMode, setAuthMode] = useState(() => inferBedrockAuthMode(config));

  useEffect(() => {
    const hasAuthShape = !!(config?.accessKeyId || config?.apiKey || config?.secretAccessKey);

    if (!hasAuthShape) return;

    setAuthMode(inferBedrockAuthMode(config));
  }, [config?.accessKeyId, config?.apiKey, config?.secretAccessKey]);

  const authModeOptions = useMemo<TabsItem[]>(
    () => [
      { key: BedrockAuthMode.ApiKey, label: t('bedrock.authMode.options.apiKey') },
      {
        key: BedrockAuthMode.AwsCredentials,
        label: t('bedrock.authMode.options.awsCredentials'),
      },
    ],
    [t],
  );

  const updateKeyVaults = useCallback(
    (params: Record<string, string | undefined>, nextMode = authMode) => {
      if (!canManageProvider) return;

      void setConfig(ModelProvider.Bedrock, {
        keyVaults: normalizeBedrockKeyVaultsForAuthMode(nextMode, params),
      });
    },
    [authMode, canManageProvider, setConfig],
  );

  const handleAuthModeChange = useCallback(
    (mode: string) => {
      if (!canManageProvider) return;

      const nextMode = mode as BedrockAuthMode;

      setAuthMode(nextMode);
      updateKeyVaults({}, nextMode);
    },
    [canManageProvider, updateKeyVaults],
  );

  return (
    <FormAction
      avatar={<Aws.Color color={cssVar.colorText} size={56} />}
      description={description}
      title={t('bedrock.unlock.title')}
    >
      <Tabs
        activeKey={authMode}
        items={authModeOptions}
        style={{ width: '100%' }}
        styles={{
          list: { display: 'flex', width: '100%' },
          tab: { flex: 1 },
        }}
        onChange={handleAuthModeChange}
      />
      {authMode === BedrockAuthMode.ApiKey ? (
        <InputPassword
          autoComplete={'new-password'}
          disabled={!canManageProvider}
          placeholder={t('bedrock.apiKey.placeholder')}
          value={apiKey}
          variant={'filled'}
          onChange={(e) => {
            updateKeyVaults({ apiKey: e.target.value });
          }}
        />
      ) : (
        <>
          <InputPassword
            autoComplete={'new-password'}
            disabled={!canManageProvider}
            placeholder={t('bedrock.accessKeyId.placeholder')}
            value={accessKeyId}
            variant={'filled'}
            onChange={(e) => {
              updateKeyVaults({ accessKeyId: e.target.value });
            }}
          />
          <InputPassword
            autoComplete={'new-password'}
            disabled={!canManageProvider}
            placeholder={t('bedrock.secretAccessKey.placeholder')}
            value={secretAccessKey}
            variant={'filled'}
            onChange={(e) => {
              updateKeyVaults({ secretAccessKey: e.target.value });
            }}
          />
          {showSessionToken ? (
            <InputPassword
              autoComplete={'new-password'}
              disabled={!canManageProvider}
              placeholder={t('bedrock.sessionToken.placeholder')}
              value={sessionToken}
              variant={'filled'}
              onChange={(e) => {
                updateKeyVaults({ sessionToken: e.target.value });
              }}
            />
          ) : (
            <Button
              block
              disabled={!canManageProvider}
              icon={ShieldPlus}
              type={'text'}
              onClick={() => {
                if (!canManageProvider) return;

                setShowSessionToken(true);
              }}
            >
              {t('bedrock.unlock.customSessionToken')}
            </Button>
          )}
        </>
      )}
      {showRegion ? (
        <Select
          disabled={!canManageProvider}
          placeholder={t('bedrock.region.placeholder')}
          style={{ width: '100%' }}
          value={region}
          options={['us-east-1', 'us-west-2', 'ap-southeast-1', 'eu-central-1'].map((i) => ({
            label: i,
            value: i,
          }))}
          onChange={(region) => {
            updateKeyVaults({ region });
          }}
        />
      ) : (
        <Button
          block
          disabled={!canManageProvider}
          icon={<Icon icon={Network} />}
          type={'text'}
          onClick={() => {
            if (!canManageProvider) return;

            setShow(true);
          }}
        >
          {t('bedrock.unlock.customRegion')}
        </Button>
      )}
    </FormAction>
  );
});

export default BedrockForm;
