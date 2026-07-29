'use client';

import { isDesktop } from '@lobechat/const';
import type { ImessageBridgeConfig, ImessageBridgeStatus } from '@lobechat/electron-client-ipc';
import { Flexbox, FormItem, Icon, Tag, Text } from '@lobehub/ui';
import { Button, Switch } from '@lobehub/ui/base-ui';
import { App, Form as AntdForm } from 'antd';
import { createStaticStyles } from 'antd-style';
import { KeyRound, Link2, Wrench } from 'lucide-react';
import { memo, use, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInput, FormPassword } from '@/components/FormInput';
import InfoTooltip from '@/components/InfoTooltip';
import { useClientDataSWR } from '@/libs/swr';
import { imessageKeys } from '@/libs/swr/keys';
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
  fieldIcon: css`
    flex: none;
    color: ${cssVar.colorTextSecondary};
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

type TestStatus = 'idle' | 'success' | 'failed';

const BLUEBUBBLES_ICON_URL = 'https://bluebubbles.app/web/splash/img/light-2x.png';

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const CredentialExtras = memo(() => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;
  const { message } = App.useApp();
  const form = AntdForm.useFormInstance();
  const applicationId = AntdForm.useWatch('applicationId', form) as string | undefined;
  const appId = applicationId?.trim();
  const postSave = use(ChannelPostSaveContext);

  // Source of truth: the bridge status lives in the Electron main process. Read
  // it through SWR (revalidates on focus + after each mutation) instead of
  // caching a copy that can drift — so there's no manual Refresh to keep in sync.
  const { data: status, mutate } = useClientDataSWR<ImessageBridgeStatus | undefined>(
    isDesktop ? imessageKeys.bridgeStatus() : null,
    () => imessageBridgeService.getStatus(),
  );

  const savedConfig = status?.configs.find((config) => config.applicationId === appId);
  const enabled = savedConfig?.enabled ?? false;
  const passwordSet = savedConfig?.blueBubblesPasswordSet ?? false;
  const running = status?.running ?? false;
  const serverUrl = status?.serverUrl;
  // The loopback server is shared across bot configs; scope the displayed state
  // to this bot by folding in its (SoT) enable flag.
  const bridgeActive = running && enabled;

  // Draft credentials the operator types — kept local until a save action (the
  // unified "Save Configuration" click, or flipping Enable on) persists them.
  const [serverUrlInput, setServerUrlInput] = useState('');
  const [serverUrlDirty, setServerUrlDirty] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testing, setTesting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(null);

  // Seed the Server URL input from the saved config once it loads, unless the
  // operator has already started editing it.
  const savedServerUrl = savedConfig?.blueBubblesServerUrl;
  useEffect(() => {
    if (!serverUrlDirty && savedServerUrl) setServerUrlInput(savedServerUrl);
  }, [savedServerUrl, serverUrlDirty]);

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

  // Build + validate the bridge config from the current draft. Throws (rather
  // than warning + returning) so each caller can surface the error.
  const buildBridgeConfig = useCallback(
    (enabledValue: boolean): ImessageBridgeConfig => {
      const blueBubblesServerUrl = serverUrlInput.trim();
      const blueBubblesPassword = passwordInput.trim();

      if (!appId) throw new Error(t('channel.imessage.bridgeMissingApplicationId'));
      if (!blueBubblesServerUrl) throw new Error(t('channel.imessage.bridgeMissingServerUrl'));
      if (!blueBubblesPassword && !passwordSet) {
        throw new Error(t('channel.imessage.bridgeMissingPassword'));
      }

      return {
        applicationId: appId,
        blueBubblesPassword: blueBubblesPassword || undefined,
        blueBubblesServerUrl,
        enabled: enabledValue,
        webhookSecret: ensureWebhookSecret(),
      };
    },
    [appId, serverUrlInput, passwordInput, passwordSet, ensureWebhookSecret, t],
  );

  // Persist the draft to the main process and revalidate the SoT. Enabling also
  // starts the loopback server + registers the BlueBubbles webhook (which needs
  // a valid Server URL + password), so the toggle reuses this same path.
  const persistConfig = useCallback(
    async (enabledValue: boolean) => {
      const config = buildBridgeConfig(enabledValue);
      await fillDesktopDeviceId();
      await imessageBridgeService.upsertConfig(config);
      setPasswordInput('');
      setTestStatus('idle');
      await mutate();
    },
    [buildBridgeConfig, fillDesktopDeviceId, mutate],
  );

  // Persist as part of the single "Save Configuration" click. Skip when there's
  // nothing to save so an untouched bridge never blocks the channel save.
  const saveBridge = useCallback(async () => {
    if (!serverUrlInput.trim() && !savedConfig) return;
    await persistConfig(enabled);
  }, [persistConfig, serverUrlInput, savedConfig, enabled]);

  useEffect(() => {
    if (!isDesktop) return;
    void fillDesktopDeviceId();
    ensureWebhookSecret();
  }, [applicationId, fillDesktopDeviceId, ensureWebhookSecret]);

  // Hook the bridge save into the main "Save Configuration" flow.
  useEffect(() => {
    if (!isDesktop || !postSave) return;
    postSave.register(saveBridge);
    return () => postSave.register(null);
  }, [postSave, saveBridge]);

  if (!isDesktop) return null;

  // Enabling is a write-through mutation: it auto-saves the current draft and
  // starts/stops the bridge immediately, so the toggle reflects the real state.
  const handleToggleEnabled = async (next: boolean) => {
    setToggling(true);
    setOptimisticEnabled(next);
    try {
      await persistConfig(next);
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setOptimisticEnabled(null);
      setToggling(false);
    }
  };

  // Testing pings BlueBubbles directly — independent of whether the bridge is
  // enabled/running. It only needs a reachable Server URL + password.
  const canTest = Boolean(appId && serverUrlInput.trim() && (passwordInput.trim() || passwordSet));

  const handleTest = async () => {
    setTesting(true);
    try {
      const config = buildBridgeConfig(enabled);
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

      {/* Middle: the credential fields the operator fills in. */}
      <FormItem
        avatar={<Icon className={styles.fieldIcon} icon={Link2} size={20} />}
        minWidth={'max(50%, 360px)'}
        variant="outlined"
        label={
          <Flexbox horizontal align="center" gap={8}>
            {t('channel.imessage.blueBubblesServerUrl')}
            <InfoTooltip
              size={'small'}
              title={`${t('channel.imessage.blueBubblesServerUrlHint')} ${t('channel.imessage.blueBubblesServerUrlTip')}`}
            />
          </Flexbox>
        }
      >
        <FormInput
          placeholder="http://127.0.0.1:1234"
          value={serverUrlInput}
          onChange={(value) => {
            setServerUrlInput(value);
            setServerUrlDirty(true);
            setTestStatus('idle');
          }}
        />
      </FormItem>
      <FormItem
        divider
        avatar={<Icon className={styles.fieldIcon} icon={KeyRound} size={20} />}
        minWidth={'max(50%, 360px)'}
        variant="outlined"
        label={
          <Flexbox horizontal align="center" gap={8}>
            {t('channel.imessage.blueBubblesPassword')}
            <InfoTooltip size={'small'} title={t('channel.imessage.blueBubblesPasswordHint')} />
          </Flexbox>
        }
      >
        <FormPassword
          autoComplete="new-password"
          placeholder={passwordSet ? t('channel.imessage.bridgePasswordSavedPlaceholder') : ''}
          value={passwordInput}
          onChange={(value) => {
            setPasswordInput(value);
            setTestStatus('idle');
          }}
        />
      </FormItem>

      {/* Bottom: row 1 — service status + the Enable toggle (write-through);
          row 2 — the connection test. */}
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
              checked={optimisticEnabled ?? enabled}
              loading={toggling}
              onChange={handleToggleEnabled}
            />
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" gap={12} justify="flex-end">
          <Button
            disabled={!canTest}
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
