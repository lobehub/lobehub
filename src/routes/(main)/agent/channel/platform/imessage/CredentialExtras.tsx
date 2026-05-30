'use client';

import { isDesktop } from '@lobechat/const';
import type {
  ImessageBridgeConfig,
  ImessageBridgePublicConfig,
} from '@lobechat/electron-client-ipc';
import { Flexbox, FormItem, Tag, Text } from '@lobehub/ui';
import { App, Button, Form as AntdForm, Switch } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Info, RefreshCw, Wrench } from 'lucide-react';
import { memo, use, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { imessageBridgeService } from '@/services/electron/imessageBridge';

import { ChannelPostSaveContext } from '../../detail/postSaveContext';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    margin-block: 8px;
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  headerIcon: css`
    overflow: hidden;
    flex: none;

    width: 44px;
    height: 44px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  `,
  infoBox: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  statusCard: css`
    padding: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  title: css`
    font-size: 15px;
    font-weight: 600;
  `,
}));

interface BridgeFormState {
  blueBubblesPassword: string;
  blueBubblesServerUrl: string;
  enabled: boolean;
}

type TestStatus = 'idle' | 'success' | 'failed';

const BLUEBUBBLES_ICON_URL = 'https://bluebubbles.app/web/splash/img/light-2x.png';

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
  // Tracks whether the current config has passed a connection test. Reset to
  // `idle` whenever a field changes so the header badge never claims a stale pass.
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');

  // Editing any field invalidates the previous test result.
  const patchBridgeForm = useCallback((patch: Partial<BridgeFormState>) => {
    setBridgeForm((previous) => ({ ...previous, ...patch }));
    setTestStatus('idle');
  }, []);

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
      setTestStatus('success');
      message.success(t('channel.imessage.bridgeTestSuccess'));
    } catch (error) {
      setTestStatus('failed');
      message.error(`${t('channel.imessage.bridgeTestFailed')}: ${getErrorMessage(error)}`);
    } finally {
      setTesting(false);
    }
  };

  const statusBadge = {
    failed: { color: 'red', text: t('channel.imessage.bridgeStatusFailed') },
    idle: { color: 'gold', text: t('channel.imessage.bridgeStatusPending') },
    success: { color: 'green', text: t('channel.imessage.bridgeStatusConnected') },
  }[testStatus];

  // The loopback server is shared across all bot configs, but this card is
  // scoped to one bot — fold in this config's enable toggle so flipping it off
  // reflects immediately, instead of waiting for the next save to tear the
  // server down (which is what `running` alone reports).
  const bridgeActive = running && bridgeForm.enabled;

  // `{url}` is a single-brace placeholder (react-i18next only parses `{{ }}`),
  // so it never registers as a namespace interpolation variable — keeping the
  // typed `t`/`Trans` inference for the whole `agent` namespace untouched.
  const bridgeDesc = bridgeActive
    ? serverUrl
      ? t('channel.imessage.bridgeRunningDescListening').replace('{url}', serverUrl)
      : t('channel.imessage.bridgeRunningDesc')
    : t('channel.imessage.bridgeStoppedDesc');

  return (
    <Flexbox className={styles.card}>
      {/* Top: logo spanning both lines, then title + status and the subtitle.
          Reserve breathing room below so the header doesn't crowd the form. */}
      <Flexbox horizontal align="center" gap={12} style={{ marginBlockEnd: 24 }}>
        <Flexbox align="center" className={styles.headerIcon} justify="center">
          <img alt="BlueBubbles" src={BLUEBUBBLES_ICON_URL} />
        </Flexbox>
        <Flexbox gap={4}>
          <Flexbox horizontal align="center" gap={8}>
            <Text className={styles.title}>{t('channel.imessage.bridgeSectionTitle')}</Text>
            <Tag color={statusBadge.color}>{statusBadge.text}</Tag>
          </Flexbox>
          <Text type="secondary">{t('channel.imessage.bridgeSectionDesc')}</Text>
        </Flexbox>
      </Flexbox>

      {/* Middle: the form fields the operator fills in. */}
      <FormItem
        desc={t('channel.imessage.blueBubblesServerUrlHint')}
        label={t('channel.imessage.blueBubblesServerUrl')}
        minWidth={'max(50%, 360px)'}
        variant="borderless"
      >
        <Flexbox gap={8}>
          <FormInput
            placeholder="http://127.0.0.1:1234"
            value={bridgeForm.blueBubblesServerUrl}
            onChange={(value) => patchBridgeForm({ blueBubblesServerUrl: value })}
          />
          <Flexbox horizontal align="flex-start" className={styles.infoBox} gap={8}>
            <Info size={14} style={{ flex: 'none', marginBlockStart: 3 }} />
            <Text fontSize={12} type="secondary">
              {t('channel.imessage.blueBubblesServerUrlTip')}
            </Text>
          </Flexbox>
        </Flexbox>
      </FormItem>
      <FormItem
        divider
        desc={t('channel.imessage.blueBubblesPasswordHint')}
        label={t('channel.imessage.blueBubblesPassword')}
        minWidth={'max(50%, 360px)'}
        variant="borderless"
      >
        <FormPassword
          autoComplete="new-password"
          placeholder={passwordSet ? t('channel.imessage.bridgePasswordSavedPlaceholder') : ''}
          value={bridgeForm.blueBubblesPassword}
          onChange={(value) => patchBridgeForm({ blueBubblesPassword: value })}
        />
      </FormItem>

      {/* Bottom: row 1 — service status + the primary Enable toggle; row 2 —
          the less-frequent Refresh / Test actions. */}
      <Flexbox className={styles.statusCard} gap={12} style={{ marginBlockStart: 16 }}>
        <Flexbox horizontal align="center" gap={16} justify="space-between">
          <Flexbox gap={2}>
            <Flexbox horizontal align="center" gap={8}>
              <Text style={{ fontWeight: 500 }}>
                {bridgeActive
                  ? t('channel.imessage.bridgeRunningTitle')
                  : t('channel.imessage.bridgeStoppedTitle')}
              </Text>
              <Tag color={bridgeActive ? 'green' : 'default'}>
                {bridgeActive
                  ? t('channel.imessage.bridgeRunning')
                  : t('channel.imessage.bridgeStopped')}
              </Tag>
            </Flexbox>
            <Text fontSize={12} type="secondary">
              {bridgeDesc}
            </Text>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8} style={{ flex: 'none' }}>
            <Text style={{ fontWeight: 500 }}>{t('channel.imessage.bridgeEnabled')}</Text>
            <Switch
              checked={bridgeForm.enabled}
              onChange={(enabled) => patchBridgeForm({ enabled })}
            />
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" gap={12} justify="flex-end">
          <Button icon={<RefreshCw size={14} />} loading={loading} onClick={refreshStatus}>
            {t('channel.imessage.bridgeRefresh')}
          </Button>
          <Button
            disabled={!bridgeActive}
            icon={<Wrench size={14} />}
            loading={testing}
            onClick={handleTest}
          >
            {t('channel.imessage.bridgeTest')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default CredentialExtras;
