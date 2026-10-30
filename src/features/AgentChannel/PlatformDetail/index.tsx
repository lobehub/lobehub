'use client';

import { agentDisplayName } from '@lobechat/types';
import { ActionIcon, Alert, Button, confirmModal, Drawer, Flexbox, Icon, toast } from '@lobehub/ui';
import { useForm, useWatch } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useClientDataSWR } from '@/libs/swr';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';
import { agentBotProviderService } from '@/services/agentBotProvider';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { BOT_RUNTIME_STATUSES, type BotRuntimeStatusSnapshot } from '@/types/botRuntimeStatus';

import { platformCredentialBodyMap } from '../platform/registry';
import { getSetupGuide } from '../quickSetup/guides';
import { keepPendingConnectResult, toTestResult } from './actionResults';
import Body, { type ModuleControls } from './Body';
import { ChannelHero } from './ChannelHero';
import { ChannelTabBar } from './ChannelTabBar';
import {
  type ChannelTab,
  defaultTab,
  footerSaveHidden,
  resolveTabs,
  tabsWithIssues,
} from './channelTabs';
import { FooterActions, FooterNotices } from './Footer';
import {
  findOverLimitSettings,
  getChannelFormValues,
  isWakeMasterReleased,
  mergeCredentialsForSave,
  mergeSettingsWithDefaults,
  shouldAdoptIncomingConfig,
  withWakeMasterOn,
} from './formState';
import { type ChannelPostSave, ChannelPostSaveContext } from './postSaveContext';
import { QuickView } from './QuickView';
import { hasPendingChanges, pickKeys, replyDiffers } from './replySettings';
import { createSaveCoordinator } from './saveCoordinator';
import {
  dirtyModuleIds,
  discardPatch,
  resolveSaveModules,
  type SaveModuleId,
  settingsToSave,
  tabOfModule,
} from './saveModules';
import { getSchemaFields, groupSettingsFields, REPLY_KEYS } from './settingsGroups';
import { useNarrowLayout } from './useNarrowLayout';

const styles = stylex.create({
  content: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
    paddingInline: '24px',
  },
  layout: {
    display: 'grid',
    flex: '1',
    gap: 0,
    alignItems: 'stretch',
    width: '100%',
    gridTemplateColumns: {
      'default': 'minmax(0, 1fr) 360px',
      ':is([data-preview="closed"], [data-narrow="true"])': 'minmax(0, 1fr)',
    },
  },
  primary: {
    display: 'flex',
    gridColumn: '1',
    gridRow: '1',
    flexDirection: 'column',
    alignItems: 'center',
    minWidth: 0,
    paddingBlockStart: '16px',
    paddingBlockEnd: '24px',
    paddingInlineEnd: {
      'default': '32px',
      ':is([data-preview="closed"], [data-narrow="true"])': 0,
    },
  },
  hero: { width: '100%', maxWidth: '1024px', paddingBlockEnd: '16px' },
  tabs: { width: '100%', maxWidth: '1024px' },
  quickView: {
    gridColumn: '2',
    gridRow: '1',
    paddingInlineStart: '32px',
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
  },
  quickViewSticky: { position: 'sticky', insetBlockStart: 0, paddingBlockStart: '24px' },
  main: {
    position: 'relative',
    display: 'flex',
    flexGrow: '1',
    flexShrink: '0',
    flexBasis: 'auto',
    flexDirection: 'column',
    width: '100%',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

const omitUndefinedValues = <T extends Record<string, unknown>>(record: T) =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;

const getFormValues = (
  schema: SerializedPlatformDefinition['schema'],
  config?: CurrentConfig,
  wakeReleased = false,
): ChannelFormValues => {
  const values = config ? getChannelFormValues(config) : { credentials: {}, settings: {} };
  const settings = mergeSettingsWithDefaults(schema, omitUndefinedValues(values.settings));
  return {
    ...values,
    settings: withWakeMasterOn(settings, wakeReleased) as Record<string, {} | undefined>,
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
    // The name the agent is addressed by; its title is the role, used only when it has no name.
    const agentName = useAgentStore((s) =>
      agentDisplayName(agentSelectors.getAgentMetaById(agentId)(s)),
    );
    const agentAvatar = useAgentStore((s) => agentSelectors.getAgentMetaById(agentId)(s).avatar);
    const agentBackground = useAgentStore(
      (s) => agentSelectors.getAgentMetaById(agentId)(s).backgroundColor,
    );

    // Options behind a rollout flag are left out of the tabs until the flag is on.
    const featureFlags = useServerConfigStore((state) => state.featureFlags) as
      Record<string, unknown> | undefined;
    const wakeReleased = isWakeMasterReleased(platformDef.schema, featureFlags);
    // What is stored, in form shape. The reply settings are compared against it
    // to decide what to save on the spot, everything else to decide what still
    // waits for the Save button.
    const storedValues = useMemo(
      () => getFormValues(platformDef.schema, currentConfig, wakeReleased),
      [platformDef.schema, currentConfig, wakeReleased],
    );
    const storedRef = useRef(storedValues);
    useEffect(() => {
      storedRef.current = storedValues;
    }, [storedValues]);
    // The chat preview sits beside the form while there is room, and can be
    // folded away; on a narrow window it opens from the right instead.
    const narrow = useNarrowLayout();
    const [previewOpen, setPreviewOpen] = useState(true);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const previewInline = !narrow && previewOpen;
    const replyKeys = useMemo(
      () =>
        REPLY_KEYS.filter((key) =>
          getSchemaFields(platformDef.schema, 'settings').some((field) => field.key === key),
        ),
      [platformDef.schema],
    );
    const valuesChangedRef = useRef<() => void>(undefined);
    const autoSavingRef = useRef(false);
    // Reply autosaves and the Save button both write the whole settings column;
    // this keeps them from overlapping (see `createSaveCoordinator`).
    const saveCoordinator = useMemo(() => createSaveCoordinator(), []);

    const [isDirty, setIsDirty] = useState(false);
    // Which blocks hold a change that is not saved yet, and which one is being saved.
    const [dirtyModules, setDirtyModules] = useState<SaveModuleId[]>([]);
    const [savingModule, setSavingModule] = useState<SaveModuleId>();
    const saveQueueRef = useRef<Promise<void>>(undefined);
    const form = useForm<ChannelFormValues>({
      initialValues: getFormValues(platformDef.schema, currentConfig, wakeReleased),
      onValuesChange: () => valuesChangedRef.current?.(),
    });

    // Which tab is open, kept in `?tab=` so a reload or a shared link lands on it. No value
    // means nobody picked one, so the page picks: connecting for a new channel, the first
    // settings tab once it is saved. Switching platforms changes the path and drops the query.
    const [searchParams, setSearchParams] = useSearchParams();
    const pickedTab = (searchParams.get('tab') ?? undefined) as ChannelTab | undefined;
    const setPickedTab = useCallback(
      (tab: ChannelTab) =>
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set('tab', tab);
            return next;
          },
          { replace: true },
        ),
      [setSearchParams],
    );
    const tabs = useMemo(
      () =>
        resolveTabs(
          groupSettingsFields(getSchemaFields(platformDef.schema, 'settings', featureFlags)).map(
            (group) => group.key,
          ),
        ),
      [featureFlags, platformDef.schema],
    );
    const activeTab =
      pickedTab && tabs.includes(pickedTab) ? pickedTab : defaultTab(tabs, !!currentConfig);
    // The blocks the page saves one by one. A platform with its own credential body (WeChat)
    // connects through its own flow, so it has no credentials block.
    const saveModules = useMemo(() => {
      const credentialFields = getSchemaFields(platformDef.schema, 'credentials', featureFlags);
      const hasCredentials =
        !platformCredentialBodyMap[platformDef.id] &&
        (credentialFields.length > 0 ||
          platformDef.schema.some((field) => field.key === 'applicationId'));

      return resolveSaveModules(
        groupSettingsFields(getSchemaFields(platformDef.schema, 'settings', featureFlags)),
        hasCredentials,
        credentialFields.map((field) => field.key),
      );
    }, [featureFlags, platformDef.id, platformDef.schema]);
    const pendingTabs = useMemo(() => [...new Set(dirtyModules.map(tabOfModule))], [dirtyModules]);
    const watchedValues = useWatch(form, (values) => values);
    // The open tab already shows its own problems; the dot is for the others.
    const tabIssues = useMemo(
      () =>
        watchedValues
          ? tabsWithIssues(watchedValues, platformDef.schema).filter((tab) => tab !== activeTab)
          : [],
      [activeTab, platformDef.schema, watchedValues],
    );
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

    // Failures from an explicit save, connect or test show in the notices at the
    // top of the form; bring them into view, since Save may have been clicked far
    // below (the last setup step, the bottom bar). Live runtime updates do not scroll.
    const noticesRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if ([saveResult, connectNotice, testResult].some((result) => result?.type === 'error')) {
        noticesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      // A reply setting is being saved: the copy coming back may not have this
      // person's latest toggle yet, and adopting it would flip the toggle back.
      if (autoSavingRef.current) return;

      form.reset(getFormValues(platformDef.schema, currentConfig, wakeReleased));
      setIsDirty(false);
      setDirtyModules([]);
    }, [currentConfig, wakeReleased, form, platformDef.schema, isDirty]);

    // Reply settings are switches and choices whose effect is seen at once in
    // the chat, so they are stored as soon as they change instead of waiting for
    // the Save button. Only the reply keys are written, on top of what is stored:
    // a half-finished edit on another tab is neither saved nor lost.
    const saveReplySettings = useCallback(async () => {
      if (!currentConfig || writeDisabled || replyKeys.length === 0) return;
      if (autoSavingRef.current || saveCoordinator.isExplicit()) return;

      const { valid } = await form.validate(replyKeys.map((key) => `settings.${key}` as const));
      // The Save button may have started while this was validating; it writes these values too.
      if (!valid || saveCoordinator.isExplicit()) return;

      const values = form.getValues();
      const stored = storedRef.current;
      if (!replyDiffers(values.settings, stored.settings, replyKeys)) return;

      // This already runs inside the coordinator (`scheduleAuto` wraps it in `runAuto`), which holds
      // the autosave slot: asking `runAuto` again from in here finds the slot taken and returns
      // without saving, so a reply setting would never be written.
      autoSavingRef.current = true;
      try {
        const settings = mergeSettingsWithDefaults(
          platformDef.schema,
          omitUndefinedValues({ ...stored.settings, ...pickKeys(values.settings, replyKeys) }),
        );
        await updateBotProvider(currentConfig.id, agentId, { settings });
        storedRef.current = { ...stored, settings: settings as ChannelFormValues['settings'] };
        toast.success(t('channel.saved'));
      } catch {
        toast.error(t('channel.updateFailed'));
        form.setValues({
          settings: {
            ...form.getValues().settings,
            ...(pickKeys(stored.settings, replyKeys) as ChannelFormValues['settings']),
          },
        });
      } finally {
        autoSavingRef.current = false;
        // Anything toggled while this save was running still has to go out.
        valuesChangedRef.current?.();
      }
    }, [
      agentId,
      currentConfig,
      form,
      platformDef.schema,
      replyKeys,
      saveCoordinator,
      t,
      updateBotProvider,
      writeDisabled,
    ]);

    const handleValuesChange = useCallback(() => {
      const values = form.getValues();
      setIsDirty(hasPendingChanges(values, storedRef.current, replyKeys));
      setDirtyModules(dirtyModuleIds(saveModules, values, storedRef.current));

      if (!currentConfig || writeDisabled || replyKeys.length === 0) return;
      if (!replyDiffers(values.settings, storedRef.current.settings, replyKeys)) return;

      saveCoordinator.scheduleAuto(saveReplySettings, 400);
    }, [
      currentConfig,
      form,
      replyKeys,
      saveCoordinator,
      saveModules,
      saveReplySettings,
      writeDisabled,
    ]);
    useEffect(() => {
      valuesChangedRef.current = handleValuesChange;
    }, [handleValuesChange]);
    useEffect(() => () => saveCoordinator.dispose(), [saveCoordinator]);

    const handleSave = useCallback(async () => {
      if (writeDisabled) return;

      // This save writes the reply settings too: drop a pending autosave, wait
      // for one already on its way, and keep new ones out until this is done.
      await saveCoordinator.beginExplicit();

      try {
        const { valid } = await form.validate();
        if (!valid) {
          // The invalid field may be on a tab that is not open. Open the first tab
          // that has one, from the field the form marked, else from what is missing.
          const marked = document
            .querySelector('[role="tabpanel"][id^="channel-panel-"] [data-invalid]')
            ?.closest('[role="tabpanel"]')
            ?.id.replace('channel-panel-', '') as ChannelTab | undefined;
          const target =
            marked && tabs.includes(marked)
              ? marked
              : tabsWithIssues(form.getValues(), platformDef.schema).find((tab) =>
                  tabs.includes(tab),
                );
          if (target) setPickedTab(target);
          return;
        }
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

        // A later reply autosave builds on what is stored; make that this save
        // right away rather than when the refreshed config arrives.
        storedRef.current = {
          ...values,
          applicationId,
          credentials,
          settings: settings as ChannelFormValues['settings'],
        };
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
      } finally {
        saveCoordinator.endExplicit();
      }
    }, [
      agentId,
      platformDef,
      form,
      currentConfig,
      createBotProvider,
      updateBotProvider,
      connectCurrentBot,
      saveCoordinator,
      setPickedTab,
      tabs,
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
        onOk: async () => {
          try {
            await deleteBotProvider(currentConfig.id, agentId);
            toast.success(t('channel.removed'));
            form.reset(getFormValues(platformDef.schema, undefined, wakeReleased));
          } catch {
            toast.error(t('channel.removeFailed'));
          }
        },
        title: t('channel.removeChannel'),
      });
    }, [
      readOnly,
      currentConfig,
      agentId,
      deleteBotProvider,
      t,
      form,
      platformDef.schema,
      wakeReleased,
    ]);

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
      form.reset(getFormValues(platformDef.schema, currentConfig, wakeReleased));
      setIsDirty(false);
      setSaveResult(undefined);
      setTestResult(undefined);
    }, [currentConfig, wakeReleased, form, platformDef.schema]);

    const handleFormValuesChange = handleValuesChange;

    // Put one block back as stored; every other block keeps its edits.
    const discardModule = useCallback(
      (id: SaveModuleId) => {
        const block = saveModules.find((m) => m.id === id);
        if (!block) return;
        const stored = storedRef.current;

        if (block.kind === 'credentials') {
          form.setValues({
            applicationId: stored.applicationId,
            credentials: stored.credentials,
          } as Partial<ChannelFormValues>);
        } else {
          form.setValues({
            settings: {
              ...form.getValues().settings,
              ...(discardPatch(block, stored) as ChannelFormValues['settings']),
            },
          });
        }
        setSaveResult(undefined);
        setTestResult(undefined);
        valuesChangedRef.current?.();
      },
      [form, saveModules],
    );

    // Save one block. Only that block's options (or, for the credentials block, the application
    // id and credentials) are written on top of what is stored, so another block's unsaved edits
    // are neither saved nor lost. Saves run one at a time: each one writes the whole settings
    // column, so two in flight would let the later one undo the earlier.
    const saveModule = useCallback(
      (id: SaveModuleId) => {
        const block = saveModules.find((m) => m.id === id);
        if (!block || !currentConfig || writeDisabled) return Promise.resolve();

        const run = async () => {
          await saveCoordinator.beginExplicit();
          setSavingModule(id);

          try {
            const paths =
              block.kind === 'credentials'
                ? ['applicationId', ...block.keys.map((key) => `credentials.${key}`)]
                : block.keys.map((key) => `settings.${key}`);
            const { valid } = await form.validate(paths as never);
            if (!valid) return;

            const values = form.getValues();
            const stored = storedRef.current;

            if (block.kind === 'credentials') {
              setSaving(true);
              setSaveResult(undefined);
              setConnectNotice(undefined);
              setRuntimeHidden(true);
              setTestResult(undefined);

              const credentials = mergeCredentialsForSave(
                currentConfig.credentials,
                values.credentials,
              );
              // Telegram derives the application id from the bot token.
              let applicationId = values.applicationId || '';
              const botToken = (credentials as Record<string, string>).botToken;
              if (!applicationId && botToken && botToken.includes(':')) {
                applicationId = botToken.slice(0, botToken.indexOf(':'));
              }

              await updateBotProvider(currentConfig.id, agentId, { applicationId, credentials });
              await postSaveRef.current?.({ applicationId });
              storedRef.current = { ...stored, applicationId, credentials };
              setSaveResult({ type: 'success' });
              setTimeout(() => setSaveResult(undefined), 3000);
              setSaving(false);
              await connectCurrentBot(applicationId);
              return;
            }

            const settings = mergeSettingsWithDefaults(
              platformDef.schema,
              omitUndefinedValues(settingsToSave(block, values, stored)),
            );
            // An over-cap list is dropped wholesale by the bot-wake parser, and for an allowlist
            // that silently turns "restricted" into "unrestricted": refuse rather than persist it.
            const overLimit = findOverLimitSettings(platformDef.schema, settings);
            if (overLimit.length > 0) {
              const max = Math.min(...overLimit.map((entry) => entry.max));
              toast.error(t('channel.channelListLimit').replace('{{max}}', String(max)));
              return;
            }

            await updateBotProvider(currentConfig.id, agentId, { settings });
            storedRef.current = { ...stored, settings: settings as ChannelFormValues['settings'] };
            toast.success(t('channel.saved'));
          } catch (e: any) {
            console.error(e);
            if (block.kind === 'credentials') {
              setSaveResult({ errorDetail: e?.message || String(e), type: 'error' });
              setSaving(false);
            } else {
              toast.error(t('channel.updateFailed'));
            }
          } finally {
            saveCoordinator.endExplicit();
            setSavingModule(undefined);
            valuesChangedRef.current?.();
          }
        };

        const next = (saveQueueRef.current ?? Promise.resolve()).then(run, run);
        saveQueueRef.current = next.catch(() => undefined);

        return next;
      },
      [
        agentId,
        connectCurrentBot,
        currentConfig,
        form,
        platformDef.schema,
        saveCoordinator,
        saveModules,
        t,
        updateBotProvider,
        writeDisabled,
      ],
    );

    // Each block's Save, once the bot exists. While one is being created, the setup steps save it
    // all at once and there is nothing to save by block.
    const moduleControls = useMemo<ModuleControls | undefined>(
      () =>
        currentConfig
          ? {
              dirty: dirtyModules,
              ids: saveModules.map((module) => module.id),
              onDiscard: discardModule,
              onSave: (id) => void saveModule(id),
              saving: savingModule,
            }
          : undefined,
      [currentConfig, dirtyModules, discardModule, saveModule, saveModules, savingModule],
    );

    const handlePaidFeatureUpgrade = useCallback(() => {
      navigate('/settings/plans');
    }, [navigate]);

    return (
      <ChannelPostSaveContext value={postSaveRegistry}>
        <main {...stylex.props(styles.main)}>
          <div {...stylex.props(styles.content)}>
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
            <div
              className={stylex.props(styles.layout).className}
              data-narrow={narrow}
              data-preview={previewInline ? 'open' : 'closed'}
            >
              <div
                className={stylex.props(styles.primary).className}
                data-narrow={narrow}
                data-preview={previewInline ? 'open' : 'closed'}
              >
                <div className={stylex.props(styles.hero).className}>
                  <ChannelHero
                    applicationId={currentConfig?.applicationId}
                    botName={agentName}
                    platformDef={platformDef}
                    status={currentConfig?.enabled ? runtimeSnapshot?.status : undefined}
                    extra={
                      previewInline ? undefined : (
                        <Button
                          icon={<Icon icon={PanelRightOpen} />}
                          onClick={() => (narrow ? setDrawerOpen(true) : setPreviewOpen(true))}
                        >
                          {t('channel.quickView.open')}
                        </Button>
                      )
                    }
                  />
                </div>
                <div className={stylex.props(styles.tabs).className}>
                  <ChannelTabBar
                    active={activeTab}
                    issues={tabIssues}
                    pending={pendingTabs}
                    tabs={tabs}
                    onChange={setPickedTab}
                  />
                </div>
                <div ref={noticesRef} style={{ scrollMarginBlockStart: 16 }} />
                <FooterNotices
                  connectResult={connectResult}
                  currentConfig={currentConfig}
                  form={form}
                  hasConfig={!!currentConfig}
                  platformDef={platformDef}
                  saveResult={saveResult}
                  testResult={testResult}
                />
                <Body
                  activeTab={activeTab}
                  currentConfig={currentConfig}
                  disabled={writeDisabled}
                  form={form}
                  hasConfig={!!currentConfig}
                  moduleControls={moduleControls}
                  platformDef={platformDef}
                  quickSetupAppName={agentName}
                  quickSetupScope={agentId}
                  saving={saving}
                  onAuthenticated={handleExternalAuth}
                  onSave={handleSave}
                  onValuesChange={handleFormValuesChange}
                />
                <FooterActions
                  connecting={connecting}
                  disabled={readOnly}
                  form={form}
                  hasConfig={!!currentConfig}
                  // A saved bot is saved block by block; the bar's Save and Discard are for creating one.
                  isDirty={!currentConfig && isDirty}
                  platformDef={platformDef}
                  saving={saving}
                  testing={testing}
                  writeDisabled={writeDisabled}
                  hideSave={
                    !!currentConfig ||
                    footerSaveHidden({
                      activeTab,
                      hasConfig: !!currentConfig,
                      // Platforms with their own credential body (WeChat, iMessage) have no steps.
                      stepSave:
                        !platformCredentialBodyMap[platformDef.id] &&
                        !!getSetupGuide(platformDef.id, { appName: '' }),
                    })
                  }
                  onCopied={() => toast.success(t('channel.copied'))}
                  onDelete={handleDelete}
                  onDiscard={handleDiscard}
                  onSave={handleSave}
                  onTestConnection={handleTestConnection}
                />
              </div>
              {previewInline && (
                <aside className={stylex.props(styles.quickView).className}>
                  <div className={stylex.props(styles.quickViewSticky).className}>
                    <QuickView
                      botAvatar={{ agentId, avatar: agentAvatar, background: agentBackground }}
                      botName={agentName}
                      form={form}
                      platformDef={platformDef}
                      extra={
                        <ActionIcon
                          aria-label={t('channel.quickView.collapse')}
                          icon={PanelRightClose}
                          title={t('channel.quickView.collapse')}
                          onClick={() => setPreviewOpen(false)}
                        />
                      }
                    />
                  </div>
                </aside>
              )}
            </div>
            <Drawer
              open={narrow && drawerOpen}
              placement={'right'}
              title={t('channel.quickView.title')}
              width={'min(420px, 92vw)'}
              onClose={() => setDrawerOpen(false)}
            >
              <QuickView
                hideTitle
                botAvatar={{ agentId, avatar: agentAvatar, background: agentBackground }}
                botName={agentName}
                form={form}
                platformDef={platformDef}
              />
            </Drawer>
          </div>
        </main>
      </ChannelPostSaveContext>
    );
  },
);

export default PlatformDetail;
