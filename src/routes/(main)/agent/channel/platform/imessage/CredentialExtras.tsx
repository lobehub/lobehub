'use client';

import { isDesktop } from '@lobechat/const';
import type {
  ImessageBridgeConfig,
  ImessageBridgePublicConfig,
} from '@lobechat/electron-client-ipc';
import { Flexbox, FormItem, Tag, Text } from '@lobehub/ui';
import { App, Button, Form as AntdForm, Switch } from 'antd';
import { RefreshCw, TestTube2 } from 'lucide-react';
import { memo, use, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { imessageBridgeService } from '@/services/electron/imessageBridge';

import { ChannelPostSaveContext } from '../../detail/postSaveContext';

interface BridgeFormState {
  blueBubblesPassword: string;
  blueBubblesServerUrl: string;
  enabled: boolean;
}

const DEFAULT_BRIDGE_FORM: BridgeFormState = {
  blueBubblesPassword: '',
  blueBubblesServerUrl: '',
  enabled: true,
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const CredentialExtras = memo(() => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;
  const { message } = App.useApp();
  const form = AntdForm.useFormInstance();
  const applicationId = AntdForm.useWatch('applicationId', form) as string | undefined;
  const postSave = use(ChannelPostSaveContext);

  const [bridgeForm, setBridgeForm] = useState<BridgeFormState>(DEFAULT_BRIDGE_FORM);
  const [loading, setLoading] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [running, setRunning] = useState(false);
  const [serverUrl, setServerUrl] = useState<string>();
  const [testing, setTesting] = useState(false);

  const fillDesktopDeviceId = useCallback(async () => {
    const deviceInfo = await gatewayConnectionService.getDeviceInfo();
    form.setFieldValue(['credentials', 'desktopDeviceId'], deviceInfo.deviceId);
    void form.validateFields([['credentials', 'desktopDeviceId']]).catch(() => undefined);
  }, [form]);

  // The webhook secret is shared between the cloud provider and the local
  // bridge but is not a user-facing field — generate one on demand and reuse
  // whatever is already stored on the form (saved config or a prior generation).
  const ensureWebhookSecret = useCallback((): string => {
    const existing = (
      form.getFieldValue(['credentials', 'webhookSecret']) as string | undefined
    )?.trim();
    if (existing) return existing;
    const generated = globalThis.crypto.randomUUID();
    form.setFieldValue(['credentials', 'webhookSecret'], generated);
    return generated;
  }, [form]);

  const refreshStatus = useCallback(async () => {
    if (!isDesktop) return;

    setLoading(true);
    try {
      await fillDesktopDeviceId();
      const status = await imessageBridgeService.getStatus();
      const savedConfig = status.configs.find(
        (config: ImessageBridgePublicConfig) => config.applicationId === applicationId?.trim(),
      );

      setBridgeForm(
        savedConfig
          ? {
              blueBubblesPassword: '',
              blueBubblesServerUrl: savedConfig.blueBubblesServerUrl,
              enabled: savedConfig.enabled,
            }
          : DEFAULT_BRIDGE_FORM,
      );
      setPasswordSet(Boolean(savedConfig?.blueBubblesPasswordSet));
      setRunning(status.running);
      setServerUrl(status.serverUrl);
    } catch (error) {
      message.error(`${t('channel.imessage.bridgeRefreshFailed')}: ${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [applicationId, fillDesktopDeviceId, message, t]);

  // Build + validate the bridge config. Throws (rather than warning + returning)
  // so the unified save flow and the Test button can each surface the error.
  const buildBridgeConfig = useCallback((): ImessageBridgeConfig => {
    const appId = applicationId?.trim();
    const blueBubblesServerUrl = bridgeForm.blueBubblesServerUrl.trim();
    const blueBubblesPassword = bridgeForm.blueBubblesPassword.trim();

    if (!appId) throw new Error(t('channel.imessage.bridgeMissingApplicationId'));
    if (!blueBubblesServerUrl) throw new Error(t('channel.imessage.bridgeMissingServerUrl'));
    if (!blueBubblesPassword && !passwordSet) {
      throw new Error(t('channel.imessage.bridgeMissingPassword'));
    }

    return {
      applicationId: appId,
      blueBubblesPassword: blueBubblesPassword || undefined,
      blueBubblesServerUrl,
      enabled: bridgeForm.enabled,
      webhookSecret: ensureWebhookSecret(),
    };
  }, [applicationId, bridgeForm, passwordSet, ensureWebhookSecret, t]);

  // Persist the Desktop-only bridge config. Registered as a post-save effect so
  // it runs as part of the single "Save Configuration" click.
  const saveBridge = useCallback(async () => {
    const config = buildBridgeConfig();
    await fillDesktopDeviceId();
    await imessageBridgeService.upsertConfig(config);
    await refreshStatus();
  }, [buildBridgeConfig, fillDesktopDeviceId, refreshStatus]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Seed a webhook secret as soon as the form is ready so the saved cloud
  // provider always carries one.
  useEffect(() => {
    if (!isDesktop) return;
    ensureWebhookSecret();
  }, [applicationId, ensureWebhookSecret]);

  // Hook the bridge save into the main "Save Configuration" flow.
  useEffect(() => {
    if (!isDesktop || !postSave) return;
    postSave.register(saveBridge);
    return () => postSave.register(null);
  }, [postSave, saveBridge]);

  if (!isDesktop) return null;

  const handleTest = async () => {
    setTesting(true);
    try {
      const config = buildBridgeConfig();
      await imessageBridgeService.testConfig(config);
      message.success(t('channel.imessage.bridgeTestSuccess'));
    } catch (error) {
      message.error(`${t('channel.imessage.bridgeTestFailed')}: ${getErrorMessage(error)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <FormItem
        divider
        desc={t('channel.imessage.blueBubblesServerUrlHint')}
        label={t('channel.imessage.blueBubblesServerUrl')}
        minWidth={'max(50%, 400px)'}
        variant="borderless"
      >
        <FormInput
          placeholder="http://127.0.0.1:1234"
          value={bridgeForm.blueBubblesServerUrl}
          onChange={(value) =>
            setBridgeForm((previous) => ({ ...previous, blueBubblesServerUrl: value }))
          }
        />
      </FormItem>
      <FormItem
        divider
        desc={t('channel.imessage.blueBubblesPasswordHint')}
        label={t('channel.imessage.blueBubblesPassword')}
        minWidth={'max(50%, 400px)'}
        variant="borderless"
      >
        <FormPassword
          autoComplete="new-password"
          placeholder={passwordSet ? t('channel.imessage.bridgePasswordSavedPlaceholder') : ''}
          value={bridgeForm.blueBubblesPassword}
          onChange={(value) =>
            setBridgeForm((previous) => ({ ...previous, blueBubblesPassword: value }))
          }
        />
      </FormItem>
      <FormItem
        divider
        desc={t('channel.imessage.bridgeEnabledHint')}
        label={t('channel.imessage.bridgeEnabled')}
        minWidth={'max(50%, 400px)'}
        variant="borderless"
      >
        <Switch
          checked={bridgeForm.enabled}
          onChange={(enabled) => setBridgeForm((previous) => ({ ...previous, enabled }))}
        />
      </FormItem>
      <Flexbox horizontal align="center" gap={8} style={{ marginBlockStart: 8 }}>
        <Tag color={running ? 'green' : 'default'}>
          {running ? t('channel.imessage.bridgeRunning') : t('channel.imessage.bridgeStopped')}
        </Tag>
        {serverUrl && (
          <Text fontSize={12} type="secondary">
            {serverUrl}
          </Text>
        )}
        <Button
          icon={<RefreshCw size={14} />}
          loading={loading}
          size="small"
          type="text"
          onClick={refreshStatus}
        >
          {t('channel.imessage.bridgeRefresh')}
        </Button>
      </Flexbox>
      <Flexbox horizontal gap={8} style={{ marginBlockStart: 12 }}>
        <Button icon={<TestTube2 size={14} />} loading={testing} onClick={handleTest}>
          {t('channel.imessage.bridgeTest')}
        </Button>
      </Flexbox>
    </>
  );
});

export default CredentialExtras;
