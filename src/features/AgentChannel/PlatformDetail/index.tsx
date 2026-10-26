'use client';

import {
  Alert,
  Button,
  confirmModal,
  createStaticStyles,
  Flexbox,
  responsive,
  Text,
  toast,
} from '@lobehub/ui';
import { useForm } from '@lobehub/ui/form';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useClientDataSWR } from '@/libs/swr';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';
import { agentBotProviderService } from '@/services/agentBotProvider';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { BOT_RUNTIME_STATUSES, type BotRuntimeStatusSnapshot } from '@/types/botRuntimeStatus';

import { getPlatformIcon } from '../const';
import { keepPendingConnectResult, toTestResult } from './actionResults';
import Body from './Body';
import {
  findOverLimitSettings,
  getChannelFormValues,
  mergeCredentialsForSave,
  mergeSettingsWithDefaults,
  shouldAdoptIncomingConfig,
} from './formState';
import { type ChannelPostSave, ChannelPostSaveContext } from './postSaveContext';
import SaveBar from './SaveBar';
import StatusAlerts from './StatusAlerts';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    display: flex;
    flex-direction: column;
    gap: 24px;
    align-items: center;

    width: 100%;
    max-width: 1072px;
    margin-inline: auto;
    padding-block: 24px 32px;
    padding-inline: 24px;

    ${responsive.sm} {
      padding-inline: 16px;
    }

    /* Let a long section description wrap instead of pushing past the card. */
    & .lobe-form-form__group-title,
    & .lobe-form-form__group-title > div {
      flex-shrink: 1;
      min-width: 0;
    }
  `,
  intro: css`
    width: 100%;
  `,
  introIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillTertiary};
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
    const agentName = useAgentStore((s) => agentSelectors.getAgentMetaById(agentId)(s).title);

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
    // Connect banner: a notice from an explicit connect action wins; otherwise
    // the banner is derived from the bot's live runtime status. Saving or testing
    // hides a settled runtime banner until the next connect.
    const [connectNotice, setConnectNotice] = useState<TestResult>();
    const [runtimeHidden, setRuntimeHidden] = useState(false);
    const [showConnected, setShowConnected] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<TestResult>();

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
              hint: runtimeStatus.errorCode
                ? t(`channel.connectionError.${runtimeStatus.errorCode}`, { defaultValue: '' }) ||
                  undefined
                : undefined,
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

    // Live runtime status of the saved bot, polled while it is still starting.
    const { data: runtimeSnapshot, mutate: refreshRuntimeStatus } =
      useClientDataSWR<BotRuntimeStatusSnapshot>(
        currentConfig?.enabled
          ? ['agentChannel/runtimeStatus', currentConfig.platform, currentConfig.applicationId]
          : null,
        () =>
          agentBotProviderService.getRuntimeStatus({
            applicationId: currentConfig!.applicationId,
            platform: currentConfig!.platform,
          }),
        {
          refreshInterval: (snapshot) =>
            snapshot?.status === BOT_RUNTIME_STATUSES.queued ||
            snapshot?.status === BOT_RUNTIME_STATUSES.starting
              ? 2000
              : 0,
          revalidateOnFocus: false,
        },
      );

    const runtimeResult = useMemo(
      () =>
        currentConfig?.enabled && runtimeSnapshot
          ? mapRuntimeStatusToResult(runtimeSnapshot, { showConnected })
          : undefined,
      [currentConfig?.enabled, mapRuntimeStatusToResult, runtimeSnapshot, showConnected],
    );
    const connectResult = connectNotice ?? (runtimeHidden ? undefined : runtimeResult);

    // Failures from an explicit save, connect or test render in the alerts at the
    // top of the page; bring them into view, since the sticky Save button may have
    // been clicked from a section far below. Live runtime updates do not scroll.
    const alertsRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if ([saveResult, connectNotice, testResult].some((result) => result?.type === 'error')) {
        alertsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, [saveResult, connectNotice, testResult]);

    const connectCurrentBot = useCallback(
      async (applicationId: string) => {
        setConnecting(true);
        try {
          const { status } = await connectBot({ agentId, applicationId, platform: platformDef.id });
          setConnectNotice({
            title: status === 'queued' ? t('channel.connectQueued') : t('channel.connectStarting'),
            type: 'info',
          });
          setShowConnected(true);
          setRuntimeHidden(false);
          await refreshRuntimeStatus();
          // The live status takes over from here (and keeps polling while starting).
          setConnectNotice(undefined);
        } catch (e: any) {
          setConnectNotice({ errorDetail: e?.message || String(e), type: 'error' });
        } finally {
          setConnecting(false);
        }
      },
      [agentId, connectBot, platformDef.id, refreshRuntimeStatus, t],
    );

    // Reset form and status when switching platforms. Must NOT depend on
    // runtimeStatus — otherwise background status refreshes would wipe
    // in-progress form edits and cancel the connect-status polling loop.
    useEffect(() => {
      setSaveResult(undefined);
      setConnectNotice(undefined);
      setRuntimeHidden(false);
      setShowConnected(false);
      setTestResult(undefined);
    }, [platformDef.id]);

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

    const handleSave = useCallback(async () => {
      if (writeDisabled) return;

      try {
        const { valid } = await form.validate();
        if (!valid) return;
        const values = form.getValues();

        setSaving(true);
        setSaveResult(undefined);
        setConnectNotice(undefined);
        setRuntimeHidden(true);
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

        // An over-cap list is dropped wholesale by the bot-wake parser, and for an allowlist that
        // silently turns "restricted" into "unrestricted". Refuse the save rather than persist a
        // value the runtime cannot honour (the list editor stops growing at the same cap).
        const overLimit = findOverLimitSettings(platformDef.schema, settings);
        if (overLimit.length > 0) {
          const max = Math.min(...overLimit.map((entry) => entry.max));
          toast.error(t('channel.channelListLimit').replace('{{max}}', String(max)));
          setSaving(false);
          return;
        }

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
        toast.success(t('channel.saved'));
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
      t,
    ]);

    const handleExternalAuth = useCallback(
      // Resolves whether the credentials were saved, so a caller holding them
      // (Feishu scan-to-create) can keep them for a retry when saving fails.
      async (params: {
        applicationId: string;
        credentials: Record<string, string>;
      }): Promise<boolean> => {
        if (writeDisabled) return false;
        let saved = false;

        setSaving(true);
        setSaveResult(undefined);
        setConnectNotice(undefined);
        setRuntimeHidden(true);
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

          saved = true;
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
        return saved;
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
        okText: t('channel.removeChannel'),
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
      // An in-progress connect notice stays; a settled banner gives way to the test result.
      setConnectNotice(keepPendingConnectResult);
      if (connectResult?.type !== 'info') setRuntimeHidden(true);
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
    }, [writeDisabled, currentConfig, connectResult, platformDef.id, testConnection, t]);

    const handleDiscard = useCallback(() => {
      form.reset(getFormValues(platformDef.schema, currentConfig));
      setIsDirty(false);
      setSaveResult(undefined);
      setTestResult(undefined);
    }, [currentConfig, form, platformDef.schema]);

    const handleFormValuesChange = useCallback(() => setIsDirty(true), []);

    const PlatformIcon = getPlatformIcon(platformDef.id) ?? getPlatformIcon(platformDef.name);

    const handlePaidFeatureUpgrade = useCallback(() => {
      navigate('/settings/plans');
    }, [navigate]);

    return (
      <ChannelPostSaveContext value={postSaveRegistry}>
        <main className={styles.main}>
          <div className={styles.content}>
            <Flexbox horizontal align={'center'} className={styles.intro} gap={12}>
              {PlatformIcon && (
                <div className={styles.introIcon}>
                  <PlatformIcon size={24} />
                </div>
              )}
              <Flexbox gap={2} style={{ minWidth: 0 }}>
                <Text as={'h1'} fontSize={20} style={{ margin: 0 }} weight={600}>
                  {platformDef.name}
                </Text>
                <Text type={'secondary'}>
                  {t('channel.detailDesc', {
                    agent: agentName || t('channel.detailDescAgentFallback'),
                    name: platformDef.name,
                  })}
                </Text>
              </Flexbox>
            </Flexbox>
            {paidFeatureBlocked && (
              <Alert
                showIcon
                style={{ width: '100%' }}
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
            <StatusAlerts
              connectResult={connectResult}
              currentConfig={currentConfig}
              form={form}
              hasConfig={!!currentConfig}
              platformDef={platformDef}
              ref={alertsRef}
              saveResult={saveResult}
              testResult={testResult}
            />
            <Body
              currentConfig={currentConfig}
              disabled={writeDisabled}
              form={form}
              hasConfig={!!currentConfig}
              platformDef={platformDef}
              quickSetupAppName={agentName}
              quickSetupScope={agentId}
              removeDisabled={readOnly || saving || connecting}
              connectionExtra={
                currentConfig ? (
                  <Button
                    disabled={writeDisabled || saving || connecting}
                    icon={<RefreshCw size={14} />}
                    loading={testing}
                    size={'small'}
                    onClick={handleTestConnection}
                  >
                    {t('channel.testConnection')}
                  </Button>
                ) : undefined
              }
              onAuthenticated={handleExternalAuth}
              onDelete={handleDelete}
              onValuesChange={handleFormValuesChange}
            />
          </div>
          <SaveBar
            connecting={connecting}
            hasConfig={!!currentConfig}
            isDirty={isDirty}
            saving={saving}
            writeDisabled={writeDisabled}
            onDiscard={handleDiscard}
            onSave={handleSave}
          />
        </main>
      </ChannelPostSaveContext>
    );
  },
);

export default PlatformDetail;
