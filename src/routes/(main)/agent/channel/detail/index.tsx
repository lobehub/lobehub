'use client';

import { Alert, Button, confirmModal, createStaticStyles, Flexbox, toast } from '@lobehub/ui';
import { useForm } from '@lobehub/ui/form';
import { ExternalLink } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';
import { agentBotProviderService } from '@/services/agentBotProvider';
import { useAgentStore } from '@/store/agent';

import {
  BOT_RUNTIME_STATUSES,
  type BotRuntimeStatusSnapshot,
} from '../../../../../types/botRuntimeStatus';
import { keepPendingConnectResult, toTestResult } from './actionResults';
import Body from './Body';
import Footer from './Footer';
import {
  getChannelFormValues,
  mergeCredentialsForSave,
  mergeSettingsWithDefaults,
  shouldAdoptIncomingConfig,
} from './formState';
import { type ChannelPostSave, ChannelPostSaveContext } from './postSaveContext';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    display: flex;
    flex-direction: column;
    align-items: center;

    width: 100%;
    padding-block: 16px 24px;
    padding-inline: 24px;
  `,
  main: css`
    position: relative;

    display: flex;
    flex: none;
    flex-direction: column;

    width: 100%;

    background: ${cssVar.colorBgContainer};
  `,
}));

const omitUndefinedValues = <T extends Record<string, unknown>>(record: T) =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;

const getFormValues = (
  schema: SerializedPlatformDefinition['schema'],
  config?: CurrentConfig,
): ChannelFormValues => {
  const values = config ? getChannelFormValues(config) : { credentials: {}, settings: {} };
  return {
    ...values,
    settings: mergeSettingsWithDefaults(schema, omitUndefinedValues(values.settings)) as Record<
      string,
      {} | undefined
    >,
  };
};

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
  /** Raw platform / server message, shown under the hint for diagnosis. */
  errorDetail?: string;
  /** Readable, localized explanation of what went wrong and what to check. */
  hint?: string;
  title?: string;
  type: 'error' | 'info' | 'success';
}

interface PlatformDetailProps {
  agentId: string;
  currentConfig?: CurrentConfig;
  disabled?: boolean;
  platformDef: SerializedPlatformDefinition;
}

const PlatformDetail = memo<PlatformDetailProps>(
  ({ platformDef, agentId, currentConfig, disabled }) => {
    const { t } = useTranslation('agent');
    const navigate = useWorkspaceAwareNavigate();

    const [isDirty, setIsDirty] = useState(false);
    const form = useForm<ChannelFormValues>({
      initialValues: getFormValues(platformDef.schema, currentConfig),
      onValuesChange: () => setIsDirty(true),
    });
    const { allowed: canEdit } = usePermission('edit_own_content');
    const activeWorkspaceId = useActiveWorkspaceId();
    const readOnly = disabled || !canEdit;
    const paidFeatureBlocked =
      platformDef.access?.requiredPlan === 'paid' && platformDef.access.allowed === false;
    const paidFeatureMode = platformDef.access?.rolloutMode ?? 'enforce';
    const paidFeatureScope = activeWorkspaceId ? 'workspace' : 'personal';
    const writeDisabled = readOnly || paidFeatureBlocked;

    const [createBotProvider, deleteBotProvider, updateBotProvider, connectBot, testConnection] =
      useAgentStore((s) => [
        s.createBotProvider,
        s.deleteBotProvider,
        s.updateBotProvider,
        s.connectBot,
        s.testConnection,
      ]);

    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [saveResult, setSaveResult] = useState<TestResult>();
    const [connectResult, setConnectResult] = useState<TestResult>();
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<TestResult>();
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
              errorDetail: runtimeStatus.errorCode
                ? t(`channel.connectionError.${runtimeStatus.errorCode}`, {
                    defaultValue: runtimeStatus.errorMessage || t('channel.connectFailed'),
                  })
                : runtimeStatus.errorMessage,
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

    // Reset form and status when switching platforms. Must NOT depend on
    // runtimeStatus — otherwise background status refreshes would wipe
    // in-progress form edits and cancel the connect-status polling loop.
    useEffect(() => {
      setSaveResult(undefined);
      setConnectResult(undefined);
      setTestResult(undefined);
      stopConnectPolling();
    }, [platformDef.id, stopConnectPolling]);

    // Sync form with saved config. The provider list is replica-backed, so on a
    // revisit the form paints the persisted config first and the live fetch
    // replaces it in the background. Adopting that background copy while the
    // user is mid-edit would silently discard their input, so a replacement of
    // the *same* provider is ignored until the form is clean again (after a
    // save / discard, or when a different provider arrives).
    const previousConfigRef = useRef<CurrentConfig | undefined>(undefined);
    useEffect(() => {
      const previous = previousConfigRef.current;
      previousConfigRef.current = currentConfig;

      if (!shouldAdoptIncomingConfig(previous, currentConfig, isDirty)) return;

      form.reset(getFormValues(platformDef.schema, currentConfig));
      setIsDirty(false);
    }, [currentConfig, form, platformDef.schema, isDirty]);

    useEffect(() => {
      if (!currentConfig?.enabled) {
        stopConnectPolling();
        setConnectResult(undefined);
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
        const { valid } = await form.validate();
        if (!valid) return;
        const values = form.getValues();

        setSaving(true);
        setSaveResult(undefined);
        setConnectResult(undefined);
        setTestResult(undefined);

        const {
          applicationId: formAppId,
          credentials: rawCredentials = {},
          settings: rawSettings = {},
        } = values;

        // The form may be seeded from the credential-trimmed persisted provider,
        // so carry any credential key it does not mention from the config the
        // form was seeded with; the server replaces the blob wholesale and would
        // otherwise delete those keys. An explicitly cleared field still wins.
        const credentials = mergeCredentialsForSave(currentConfig?.credentials, rawCredentials);
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

        setIsDirty(false);
        setSaveResult({ type: 'success' });
        setTimeout(() => setSaveResult(undefined), 3000);
        setSaving(false);

        // Auto-connect bot after save
        await connectCurrentBot(applicationId);
      } catch (e: any) {
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
        setTestResult(undefined);

        try {
          const { applicationId, credentials: authCredentials } = params;
          const credentials = mergeCredentialsForSave(currentConfig?.credentials, authCredentials);
          const settings = mergeSettingsWithDefaults(
            platformDef.schema,
            omitUndefinedValues(form.getValue('settings') || {}),
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
          setIsDirty(false);
          toast.success(t('channel.saved'));

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
            toast.success(t('channel.removed'));
            form.reset(getFormValues(platformDef.schema));
          } catch {
            toast.error(t('channel.removeFailed'));
          }
        },
        title: t('channel.removeChannel'),
      });
    }, [readOnly, currentConfig, agentId, deleteBotProvider, t, form, platformDef.schema]);

    const handleTestConnection = useCallback(async () => {
      if (writeDisabled) return;
      if (!currentConfig) {
        toast.warning(t('channel.saveFirstWarning'));
        return;
      }

      setTesting(true);
      setSaveResult(undefined);
      setTestResult(undefined);
      setConnectResult(keepPendingConnectResult);
      try {
        const result = await testConnection({
          applicationId: currentConfig.applicationId,
          platform: platformDef.id,
        });
        setTestResult(
          toTestResult(result, (code) =>
            t(`channel.connectionError.${code}`, { defaultValue: '' }),
          ),
        );
      } catch (e: any) {
        setTestResult({
          errorDetail: e?.message || String(e),
          type: 'error',
        });
      } finally {
        setTesting(false);
      }
    }, [writeDisabled, currentConfig, platformDef.id, testConnection, t]);

    const handleDiscard = useCallback(() => {
      form.reset(getFormValues(platformDef.schema, currentConfig));
      setIsDirty(false);
      setSaveResult(undefined);
      setTestResult(undefined);
    }, [currentConfig, form, platformDef.schema]);

    const handleFormValuesChange = useCallback(() => setIsDirty(true), []);

    const handlePaidFeatureUpgrade = useCallback(() => {
      navigate('/settings/plans');
    }, [navigate]);

    return (
      <ChannelPostSaveContext value={postSaveRegistry}>
        <main className={styles.main}>
          <div className={styles.content}>
            {paidFeatureBlocked && (
              <Alert
                showIcon
                style={{ marginBlockStart: 16, maxWidth: 1024, width: '100%' }}
                type={paidFeatureMode === 'notice' ? 'warning' : 'info'}
                description={t(`channel.paidFeature.${paidFeatureMode}.desc.${paidFeatureScope}`, {
                  name: platformDef.name,
                })}
                message={
                  <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
                    <span>
                      {t(`channel.paidFeature.${paidFeatureMode}.title`, {
                        name: platformDef.name,
                      })}
                    </span>
                    <Button
                      icon={<ExternalLink size={14} />}
                      size={'small'}
                      type={'primary'}
                      onClick={handlePaidFeatureUpgrade}
                    >
                      {t(`channel.paidFeature.cta.${paidFeatureScope}`)}
                    </Button>
                  </Flexbox>
                }
              />
            )}
            <Body
              currentConfig={currentConfig}
              disabled={writeDisabled}
              form={form}
              hasConfig={!!currentConfig}
              platformDef={platformDef}
              onAuthenticated={handleExternalAuth}
              onValuesChange={handleFormValuesChange}
            />
            <Footer
              connectResult={connectResult}
              connecting={connecting}
              currentConfig={currentConfig}
              disabled={readOnly}
              form={form}
              hasConfig={!!currentConfig}
              isDirty={isDirty}
              platformDef={platformDef}
              saveResult={saveResult}
              saving={saving}
              testResult={testResult}
              testing={testing}
              writeDisabled={writeDisabled}
              onCopied={() => toast.success(t('channel.copied'))}
              onDelete={handleDelete}
              onDiscard={handleDiscard}
              onSave={handleSave}
              onTestConnection={handleTestConnection}
            />
          </div>
        </main>
      </ChannelPostSaveContext>
    );
  },
);

export default PlatformDetail;
