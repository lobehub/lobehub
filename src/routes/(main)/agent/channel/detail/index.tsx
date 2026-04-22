'use client';

import { App, Form } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';
import { agentBotProviderService } from '@/services/agentBotProvider';
import { useAgentStore } from '@/store/agent';

import {
  BOT_RUNTIME_STATUSES,
  type BotRuntimeStatus,
  type BotRuntimeStatusSnapshot,
} from '../../../../../types/botRuntimeStatus';
import Body from './Body';
import Footer from './Footer';
import { getChannelFormValues, mergeSettingsWithDefaults } from './formState';
import Header from './Header';

const styles = createStaticStyles(({ css, cssVar }) => ({
  main: css`
    position: relative;

    overflow-y: auto;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;

    padding: 24px;

    background: ${cssVar.colorBgContainer};
  `,
}));

const omitUndefinedValues = <T extends Record<string, unknown>>(record: T) =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;

interface CurrentConfig {
  applicationId: string;
  credentials: Record<string, string>;
  enabled: boolean;
  id: string;
  platform: string;
  settings?: Record<string, unknown> | null;
}

export interface ChannelFormValues {
  applicationId?: string;
  credentials: Record<string, string>;
  settings: Record<string, {} | undefined>;
}

export interface TestResult {
  errorDetail?: string;
  title?: string;
  type: 'error' | 'info' | 'success';
}

interface PlatformDetailProps {
  agentId: string;
  currentConfig?: CurrentConfig;
  platformDef: SerializedPlatformDefinition;
  runtimeStatus?: BotRuntimeStatus;
}

const PlatformDetail = memo<PlatformDetailProps>(
  ({ platformDef, agentId, currentConfig, runtimeStatus }) => {
    const { t } = useTranslation('agent');
    const { message: msg, modal } = App.useApp();
    const [form] = Form.useForm<ChannelFormValues>();

    const [
      createBotProvider,
      deleteBotProvider,
      updateBotProvider,
      connectBot,
      testConnection,
      refreshBotRuntimeStatus,
    ] = useAgentStore((s) => [
      s.createBotProvider,
      s.deleteBotProvider,
      s.updateBotProvider,
      s.connectBot,
      s.testConnection,
      s.refreshBotRuntimeStatus,
    ]);

    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [pendingEnabled, setPendingEnabled] = useState<boolean>();
    const [saveResult, setSaveResult] = useState<TestResult>();
    const [connectResult, setConnectResult] = useState<TestResult>();
    const [toggleLoading, setToggleLoading] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<TestResult>();
    const [observedStatus, setObservedStatus] = useState<BotRuntimeStatus | undefined>(
      runtimeStatus,
    );
    const [refreshingStatus, setRefreshingStatus] = useState(false);
    const connectPollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const stopConnectPolling = useCallback(() => {
      if (!connectPollingTimerRef.current) return;
      clearTimeout(connectPollingTimerRef.current);
      connectPollingTimerRef.current = null;
    }, []);

    const mapRuntimeStatusToResult = useCallback(
      (
        runtimeStatus: BotRuntimeStatusSnapshot,
        options?: { showConnected?: boolean },
      ): TestResult | undefined => {
        switch (runtimeStatus.status) {
          case BOT_RUNTIME_STATUSES.connected: {
            if (!options?.showConnected) return undefined;
            return { title: t('channel.connectSuccess'), type: 'success' };
          }
          case BOT_RUNTIME_STATUSES.failed: {
            return {
              errorDetail: runtimeStatus.errorMessage,
              title: t('channel.connectFailed'),
              type: 'error',
            };
          }
          case BOT_RUNTIME_STATUSES.queued: {
            return { title: t('channel.connectQueued'), type: 'info' };
          }
          case BOT_RUNTIME_STATUSES.starting: {
            return { title: t('channel.connectStarting'), type: 'info' };
          }
          default: {
            return undefined;
          }
        }
      },
      [t],
    );

    const syncRuntimeStatus = useCallback(
      async (
        params: {
          applicationId: string;
          platform: string;
        },
        options?: { poll?: boolean; showConnected?: boolean },
      ) => {
        stopConnectPolling();

        const snapshot = await agentBotProviderService.getRuntimeStatus(params);
        setObservedStatus(snapshot.status);
        const nextResult = mapRuntimeStatusToResult(snapshot, {
          showConnected: options?.showConnected,
        });

        if (nextResult) {
          setConnectResult(nextResult);
        } else if (snapshot.status === BOT_RUNTIME_STATUSES.disconnected) {
          setConnectResult(undefined);
        }

        if (
          options?.poll &&
          (snapshot.status === BOT_RUNTIME_STATUSES.queued ||
            snapshot.status === BOT_RUNTIME_STATUSES.starting)
        ) {
          connectPollingTimerRef.current = setTimeout(() => {
            void syncRuntimeStatus(params, options);
          }, 2000);
        }
      },
      [mapRuntimeStatusToResult, stopConnectPolling],
    );

    const connectCurrentBot = useCallback(
      async (applicationId: string) => {
        setConnecting(true);
        try {
          const { status } = await connectBot({ agentId, applicationId, platform: platformDef.id });
          setConnectResult({
            title: status === 'queued' ? t('channel.connectQueued') : t('channel.connectStarting'),
            type: 'info',
          });
          await syncRuntimeStatus(
            { applicationId, platform: platformDef.id },
            { poll: true, showConnected: true },
          );
        } catch (e: any) {
          setConnectResult({ errorDetail: e?.message || String(e), type: 'error' });
        } finally {
          setConnecting(false);
        }
      },
      [agentId, connectBot, platformDef.id, syncRuntimeStatus, t],
    );

    const handleRefreshStatus = useCallback(async () => {
      if (!currentConfig?.enabled) return;
      setRefreshingStatus(true);
      try {
        const snapshot = await refreshBotRuntimeStatus({
          agentId,
          applicationId: currentConfig.applicationId,
          platform: currentConfig.platform,
        });
        setObservedStatus(snapshot.status);
        const nextResult = mapRuntimeStatusToResult(snapshot, { showConnected: true });
        if (nextResult) {
          setConnectResult(nextResult);
        } else if (snapshot.status === BOT_RUNTIME_STATUSES.disconnected) {
          setConnectResult(undefined);
        }
      } catch (e: any) {
        msg.error(e?.message || String(e));
      } finally {
        setRefreshingStatus(false);
      }
    }, [agentId, currentConfig, mapRuntimeStatusToResult, msg, refreshBotRuntimeStatus]);

    // Reset form and status when switching platforms. Must NOT depend on
    // runtimeStatus — otherwise background status refreshes would wipe
    // in-progress form edits and cancel the connect-status polling loop.
    useEffect(() => {
      form.resetFields();
      setSaveResult(undefined);
      setConnectResult(undefined);
      setTestResult(undefined);
      stopConnectPolling();
    }, [platformDef.id, form, stopConnectPolling]);

    // Keep the displayed status in sync with the latest snapshot from the
    // parent (initial load, bulk refresh, SWR revalidation).
    useEffect(() => {
      setObservedStatus(runtimeStatus);
    }, [runtimeStatus]);

    // Sync form with saved config
    useEffect(() => {
      if (currentConfig) {
        form.setFieldsValue(getChannelFormValues(currentConfig));
      }
    }, [currentConfig, form]);

    useEffect(() => {
      if (!currentConfig) {
        setPendingEnabled(undefined);
        setToggleLoading(false);
        return;
      }

      if (pendingEnabled === currentConfig.enabled) {
        setPendingEnabled(undefined);
      }
    }, [currentConfig, pendingEnabled]);

    useEffect(() => {
      if (!currentConfig?.enabled) {
        stopConnectPolling();
        setConnectResult(undefined);
        setObservedStatus(undefined);
        return;
      }

      void syncRuntimeStatus(
        {
          applicationId: currentConfig.applicationId,
          platform: currentConfig.platform,
        },
        { poll: true, showConnected: false },
      );

      return () => {
        stopConnectPolling();
      };
    }, [currentConfig, stopConnectPolling, syncRuntimeStatus]);

    const handleSave = useCallback(async () => {
      try {
        await form.validateFields();
        const values = form.getFieldsValue(true) as ChannelFormValues;

        setSaving(true);
        setSaveResult(undefined);
        setConnectResult(undefined);

        const {
          applicationId: formAppId,
          credentials: rawCredentials = {},
          settings: rawSettings = {},
        } = values as ChannelFormValues;

        // Strip undefined values from credentials (optional fields left empty by antd form)
        const credentials = Object.fromEntries(
          Object.entries(rawCredentials).filter(([, v]) => v !== undefined && v !== ''),
        );
        const settings = mergeSettingsWithDefaults(
          platformDef.schema,
          omitUndefinedValues(rawSettings),
        );

        // Use explicit applicationId from form; fall back to deriving from botToken (Telegram)
        let applicationId = formAppId || '';
        if (!applicationId && (credentials as Record<string, string>).botToken) {
          const colonIdx = (credentials as Record<string, string>).botToken.indexOf(':');
          if (colonIdx !== -1)
            applicationId = (credentials as Record<string, string>).botToken.slice(0, colonIdx);
        }

        if (currentConfig) {
          await updateBotProvider(currentConfig.id, agentId, {
            applicationId,
            credentials,
            settings,
          });
        } else {
          await createBotProvider({
            agentId,
            applicationId,
            credentials,
            platform: platformDef.id,
            settings,
          });
        }

        setSaveResult({ type: 'success' });
        setTimeout(() => setSaveResult(undefined), 3000);
        setSaving(false);

        // Auto-connect bot after save
        await connectCurrentBot(applicationId);
      } catch (e: any) {
        if (e?.errorFields) return;
        console.error(e);
        setSaveResult({ errorDetail: e?.message || String(e), type: 'error' });
        setSaving(false);
      }
    }, [
      agentId,
      platformDef,
      form,
      currentConfig,
      createBotProvider,
      updateBotProvider,
      connectCurrentBot,
    ]);

    const handleExternalAuth = useCallback(
      async (params: { applicationId: string; credentials: Record<string, string> }) => {
        setSaving(true);
        setSaveResult(undefined);
        setConnectResult(undefined);

        try {
          const { applicationId, credentials } = params;
          const settings = mergeSettingsWithDefaults(
            platformDef.schema,
            omitUndefinedValues(form.getFieldValue('settings') || {}),
          );

          if (currentConfig) {
            await updateBotProvider(currentConfig.id, agentId, {
              applicationId,
              credentials,
              settings,
            });
          } else {
            await createBotProvider({
              agentId,
              applicationId,
              credentials,
              platform: platformDef.id,
              settings,
            });
          }

          setSaveResult({ type: 'success' });
          msg.success(t('channel.saved'));

          // Auto-connect
          await connectCurrentBot(applicationId);
        } catch (e: any) {
          setSaveResult({ errorDetail: e?.message || String(e), type: 'error' });
        } finally {
          setSaving(false);
        }
      },
      [
        agentId,
        platformDef,
        form,
        currentConfig,
        createBotProvider,
        updateBotProvider,
        connectCurrentBot,
        msg,
        t,
      ],
    );

    const handleDelete = useCallback(async () => {
      if (!currentConfig) return;

      modal.confirm({
        content: t('channel.deleteConfirmDesc'),
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await deleteBotProvider(currentConfig.id, agentId);
            msg.success(t('channel.removed'));
            form.resetFields();
          } catch {
            msg.error(t('channel.removeFailed'));
          }
        },
        title: t('channel.deleteConfirm'),
      });
    }, [currentConfig, agentId, deleteBotProvider, msg, t, modal, form]);

    const handleToggleEnable = useCallback(
      async (enabled: boolean) => {
        if (!currentConfig) return;
        try {
          setPendingEnabled(enabled);
          setToggleLoading(true);
          await updateBotProvider(currentConfig.id, agentId, { enabled });
          setToggleLoading(false);
          if (enabled) {
            await connectCurrentBot(currentConfig.applicationId);
          }
        } catch {
          setPendingEnabled(undefined);
          setToggleLoading(false);
          msg.error(t('channel.updateFailed'));
        }
      },
      [currentConfig, agentId, updateBotProvider, connectCurrentBot, msg, t],
    );

    const handleTestConnection = useCallback(async () => {
      if (!currentConfig) {
        msg.warning(t('channel.saveFirstWarning'));
        return;
      }

      setTesting(true);
      setTestResult(undefined);
      try {
        await testConnection({
          applicationId: currentConfig.applicationId,
          platform: platformDef.id,
        });
        setTestResult({ type: 'success' });
      } catch (e: any) {
        setTestResult({
          errorDetail: e?.message || String(e),
          type: 'error',
        });
      } finally {
        setTesting(false);
      }
    }, [currentConfig, platformDef.id, testConnection, msg, t]);

    return (
      <main className={styles.main}>
        <Header
          currentConfig={currentConfig}
          enabledValue={pendingEnabled}
          platformDef={platformDef}
          refreshingStatus={refreshingStatus}
          runtimeStatus={observedStatus}
          toggleLoading={toggleLoading}
          onRefreshStatus={handleRefreshStatus}
          onToggleEnable={handleToggleEnable}
        />
        <Body
          currentConfig={currentConfig}
          form={form}
          hasConfig={!!currentConfig}
          platformDef={platformDef}
          onAuthenticated={handleExternalAuth}
        />
        <Footer
          connectResult={connectResult}
          connecting={connecting}
          form={form}
          hasConfig={!!currentConfig}
          platformDef={platformDef}
          saveResult={saveResult}
          saving={saving}
          testResult={testResult}
          testing={testing}
          onCopied={() => msg.success(t('channel.copied'))}
          onDelete={handleDelete}
          onSave={handleSave}
          onTestConnection={handleTestConnection}
        />
      </main>
    );
  },
);

export default PlatformDetail;
