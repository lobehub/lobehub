'use client';

import { Alert } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App, Form } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
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
import { type ChannelPostSave, ChannelPostSaveContext } from './postSaveContext';

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

export interface CurrentConfig {
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
  disabled?: boolean;
  platformDef: SerializedPlatformDefinition;
  runtimeStatus?: BotRuntimeStatus;
}

const PlatformDetail = memo<PlatformDetailProps>(
  ({ platformDef, agentId, currentConfig, disabled, runtimeStatus }) => {
    const { t } = useTranslation('agent');
    const { message: msg } = App.useApp();
    const [form] = Form.useForm<ChannelFormValues>();
    const { allowed: canEdit } = usePermission('edit_own_content');
    const readOnly = disabled || !canEdit;
    const paidFeatureBlocked =
      platformDef.access?.requiredPlan === 'paid' && platformDef.access.allowed === false;
    const paidFeatureMode = platformDef.access?.rolloutMode ?? 'enforce';
    const writeDisabled = readOnly || paidFeatureBlocked;

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

    // Platform-specific extras (e.g. iMessage's BlueBubbles bridge) register a
    // side-effect here so it runs as part of the single "Save Configuration"
    // click instead of a separate button.
    const postSaveRef = useRef<ChannelPostSave | null>(null);
    const postSaveRegistry = useMemo(
      () => ({
        register: (fn: ChannelPostSave | null) => {
          postSaveRef.current = fn;
        },
      }),
      [],
    );

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
      if (writeDisabled) return;
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
    }, [
      agentId,
      writeDisabled,
      currentConfig,
      mapRuntimeStatusToResult,
      msg,
      refreshBotRuntimeStatus,
    ]);

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
      if (writeDisabled) return;

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

        // Run any platform-specific post-save side-effect (e.g. iMessage's
        // local BlueBubbles bridge) as part of the same save.
        await postSaveRef.current?.({ applicationId });

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
      writeDisabled,
    ]);

    const handleExternalAuth = useCallback(
      async (params: { applicationId: string; credentials: Record<string, string> }) => {
        if (writeDisabled) return;

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
        writeDisabled,
        msg,
        t,
      ],
    );

    const handleDelete = useCallback(async () => {
      if (readOnly) return;
      if (!currentConfig) return;

      confirmModal({
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
    }, [readOnly, currentConfig, agentId, deleteBotProvider, msg, t, form]);

    const handleToggleEnable = useCallback(
      async (enabled: boolean) => {
        if (writeDisabled) return;
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
      [writeDisabled, currentConfig, agentId, updateBotProvider, connectCurrentBot, msg, t],
    );

    const handleTestConnection = useCallback(async () => {
      if (writeDisabled) return;
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
    }, [writeDisabled, currentConfig, platformDef.id, testConnection, msg, t]);

    return (
      <ChannelPostSaveContext value={postSaveRegistry}>
        <main className={styles.main}>
          <Header
            currentConfig={currentConfig}
            disabled={writeDisabled}
            enabledValue={pendingEnabled}
            platformDef={platformDef}
            refreshingStatus={refreshingStatus}
            runtimeStatus={observedStatus}
            toggleLoading={toggleLoading}
            onRefreshStatus={handleRefreshStatus}
            onToggleEnable={handleToggleEnable}
          />
          {paidFeatureBlocked && (
            <Alert
              showIcon
              message={t(`channel.paidFeature.${paidFeatureMode}.title`)}
              style={{ maxWidth: 1024, width: '100%' }}
              type={paidFeatureMode === 'notice' ? 'warning' : 'info'}
              description={t(`channel.paidFeature.${paidFeatureMode}.desc`, {
                name: platformDef.name,
              })}
            />
          )}
          <Body
            currentConfig={currentConfig}
            disabled={writeDisabled}
            form={form}
            hasConfig={!!currentConfig}
            platformDef={platformDef}
            onAuthenticated={handleExternalAuth}
          />
          <Footer
            connectResult={connectResult}
            connecting={connecting}
            currentConfig={currentConfig}
            disabled={readOnly}
            form={form}
            hasConfig={!!currentConfig}
            platformDef={platformDef}
            saveResult={saveResult}
            saving={saving}
            testResult={testResult}
            testing={testing}
            writeDisabled={writeDisabled}
            onCopied={() => msg.success(t('channel.copied'))}
            onDelete={handleDelete}
            onSave={handleSave}
            onTestConnection={handleTestConnection}
          />
        </main>
      </ChannelPostSaveContext>
    );
  },
);

export default PlatformDetail;
