'use client';

import { isDesktop } from '@lobechat/const';
import { HETEROGENEOUS_TYPE_LABELS } from '@lobechat/heterogeneous-agents';
import type { DeviceExecutionTarget } from '@lobechat/types';
import { Button, Flexbox, Icon, Popover, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  InfoIcon,
  MonitorDownIcon,
  SettingsIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InstantSwitch from '@/components/InstantSwitch';
import { DOWNLOAD_URL } from '@/const/url';
import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import { useLocalSandboxCapability } from '@/features/ChatInput/hooks/useLocalSandboxCapability';
import { useSelectExecutionTarget } from '@/features/ChatInput/hooks/useSelectExecutionTarget';
import DeviceLoadMeter, { useDeviceLoad } from '@/features/DeviceManager/DeviceLoadMeter';
import {
  devicePoolForAgent,
  ExecutionTargetIcon,
  groupExecutionTargetDevices,
} from '@/features/ExecutionTargetPicker';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import {
  isHeterogeneousSandboxExecutionAvailable,
  isLocalSandboxEnabled,
  resolveExecutionTarget,
} from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { localFileService } from '@/services/electron/localFileService';
import { useAgentStore } from '@/store/agent';
import { useDeviceList } from '@/store/device';
import { useElectronStore } from '@/store/electron';

import { useTopicId } from '../hooks/useTopicId';
import { formatLockedControlTooltip } from '../utils/lockedControlTooltip';
import DeviceOptionRow from './DeviceOptionRow';
import { getDevicePoolStatus } from './devicePoolStatus';
import OptionRow from './OptionRow';
import { useSandboxNetworkToggle } from './useSandboxNetworkToggle';
import { useTopicAwareTargetSelect } from './useTopicAwareTargetSelect';

const styles = stylex.create({
  button: {
    cursor: 'pointer',
    display: 'flex',
    flex: 'none',
    gap: '6px',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '4px',
    borderRadius: '4px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    whiteSpace: 'nowrap',
    transition: 'all 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  buttonLabel: {
    overflow: 'hidden',
    maxWidth: '120px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  buttonReadonly: {
    cursor: 'default',
    color: { 'default': null, ':hover': cssVar.colorTextSecondary },
    backgroundColor: { 'default': null, ':hover': 'transparent' },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  desc: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    fontSize: '11px',
    color: cssVar.colorTextDescription,
  },
  extraInfo: {
    cursor: 'help',
    display: 'flex',
    alignItems: 'center',
    color: { 'default': cssVar.colorTextQuaternary, ':hover': cssVar.colorTextSecondary },
    transition: 'color 0.2s',
  },
  deviceList: {
    overflowY: 'auto',
    maxHeight: '240px',
    marginInlineEnd: '-4px',
    paddingInlineEnd: '4px',
  },
  empty: {
    paddingBlock: '8px',
    paddingInline: '8px',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
  },
  downloadCard: {
    cursor: 'pointer',
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    paddingBlock: '8px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    textDecoration: 'none',
    transition: 'background-color 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  downloadCardArrow: { flex: 'none', marginInlineStart: 'auto', color: cssVar.colorTextQuaternary },
  optionIcon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  optionMeta: { display: 'flex', flex: '1', flexDirection: 'column', gap: '1px', minWidth: '0' },
  optionTitle: {
    overflow: 'hidden',
    fontSize: '13px',
    fontWeight: 500,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  header: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '4px',
    paddingInline: '8px',
  },
  headerInfo: {
    cursor: 'help',
    color: { 'default': cssVar.colorTextQuaternary, ':hover': cssVar.colorTextSecondary },
    transition: 'color 0.2s',
  },
  headerLink: {
    display: 'flex',
    gap: '3px',
    alignItems: 'center',
    fontSize: '11px',
    color: { 'default': cssVar.colorTextQuaternary, ':hover': cssVar.colorPrimary },
    textDecoration: 'none',
    transition: 'color 0.2s',
  },
  headerTitle: { fontSize: '12px', fontWeight: 500, color: cssVar.colorTextTertiary },
  manageButton: {
    cursor: 'pointer',
    display: 'flex',
    gap: '3px',
    alignItems: 'center',
    padding: '0',
    borderStyle: 'none',
    fontSize: '11px',
    color: { 'default': cssVar.colorTextQuaternary, ':hover': cssVar.colorPrimary },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    transition: 'color 0.2s',
  },
  groupLabel: {
    paddingBlock: '4px',
    paddingInline: '8px',
    fontSize: '11px',
    fontWeight: 500,
    color: cssVar.colorTextQuaternary,
  },
});

interface HeteroDeviceSwitcherProps {
  agentId: string;
}

const HeteroDeviceSwitcher = memo<HeteroDeviceSwitcherProps>(({ agentId }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const navigate = useWorkspaceAwareNavigate();
  const { canUseResource } = useChatInputResourceAccess();

  // This composer's conversation (see `useTopicId`): a side-by-side pane must
  // resolve, and re-pin, its own topic rather than the main column's.
  const topicId = useTopicId();
  const agentWorkspaceId = useAgentStore((s) => s.agentMap[agentId]?.workspaceId);
  const isWorkspaceAgent = Boolean(agentWorkspaceId);

  // Shared config merged with the caller's per-agent override —
  // the hook eagerly fetches the `workspaceUserSettings` bucket on mount so
  // what the picker shows and what dispatch will actually do always agree.
  const {
    agencyConfig,
    canDisplayExecutionTarget,
    canSelectExecutionTarget,
    isPreferenceLoading: isWorkspacePreferenceLoading,
    topicDeviceUnknown,
    workspaceScoped,
  } = useEffectiveAgencyConfig(agentId, { topicId });
  const canShowExecutionTarget = canUseResource && canDisplayExecutionTarget;
  const canShowExecutionTargetSelector = canShowExecutionTarget && canSelectExecutionTarget;

  const heteroType = agencyConfig?.heterogeneousProvider?.type;
  const boundDeviceId = agencyConfig?.boundDeviceId;

  // Heterogeneous agents bring their own toolchain and must execute somewhere, so `'none'`
  // (plain chat, no execution environment) isn't a valid target for them: hide
  // the option and never fall back to / honour a stale stored `'none'`.
  const isHetero = !!heteroType;
  const supportsSandbox = isHeterogeneousSandboxExecutionAvailable(heteroType);

  // The device replica, partitioned by workspace: a reload paints the persisted
  // list first, so the chip names the bound device instead of "Unknown device".
  const {
    data: devices,
    error: deviceListError,
    isConfirmed: isDeviceListConfirmed,
    isValidating: isDeviceListValidating,
    mutate: refreshDevices,
  } = useDeviceList();

  // The current machine's own gateway deviceId (desktop only), used to badge the
  // matching device row with a "This device" tag and show the local-process
  // description instead of the generic online/offline status.
  useElectronStore((s) => s.useFetchGatewayDeviceInfo)();
  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  const currentDeviceId = isDesktop ? gatewayDeviceInfo?.deviceId : undefined;
  const [reconnectingDeviceId, setReconnectingDeviceId] = useState<string>();

  const handleReconnectDevice = useCallback(
    async (deviceId: string) => {
      setReconnectingDeviceId(deviceId);
      try {
        if (isDesktop && deviceId === currentDeviceId) {
          await useElectronStore.getState().connectGateway();
        } else {
          window.location.href = `lobehub://device/reconnect?deviceId=${encodeURIComponent(deviceId)}`;
        }

        // The deep link crosses browser → desktop → gateway → server, so give
        // the live device registry a short window to converge instead of
        // making the user close and reopen the picker to see the result.
        let connected = false;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const nextDevices = await refreshDevices();
          if (nextDevices?.some((device) => device.deviceId === deviceId && device.online)) {
            connected = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!connected) toast.error(t('heteroAgent.executionTarget.reconnectFailed'));
      } catch (error) {
        console.error('Device reconnect failed:', error);
        toast.error(t('heteroAgent.executionTarget.reconnectFailed'));
      } finally {
        setReconnectingDeviceId(undefined);
      }
    },
    [currentDeviceId, refreshDevices, t],
  );

  // A member's explicit target override may resolve `local`; without one the
  // raw shared fallback stays workspace-scoped so a legacy `local` value keeps
  // routing to its bound workspace device rather than this member's desktop.
  const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);
  const executionTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero,
    workspaceScoped,
  });
  // A read-only member receives the safe target type but not `boundDeviceId`.
  // Use the stored type for the summary so a fixed, bound `local` target is
  // described as a workspace device instead of being client-coerced to sandbox.
  const chipExecutionTarget = canShowExecutionTargetSelector
    ? executionTarget
    : (agencyConfig?.executionTarget ?? executionTarget);

  // Device-only CLIs cannot fall back to the cloud sandbox. When a web/legacy
  // config has no usable device target, open the picker once so `none` is an
  // explicit setup prompt rather than a disabled-but-active sandbox row.
  useEffect(() => {
    if (!canShowExecutionTargetSelector) return;
    if (supportsSandbox) return;
    if (isWorkspacePreferenceLoading) return;
    if (executionTarget !== 'none') return;
    setOpen(true);
  }, [
    canShowExecutionTargetSelector,
    executionTarget,
    isWorkspacePreferenceLoading,
    supportsSandbox,
  ]);

  // The sandbox is a modifier on `local`, not a target of its own, so the two
  // local rows differ only by this flag. Reading it through the same helper the
  // server and the desktop runner use keeps the checkmark honest: it lights up
  // exactly when a command would actually be fenced.
  const localSandboxEnabled = isLocalSandboxEnabled(agencyConfig, executionTarget);
  const localSandboxNetwork = agencyConfig?.localSandboxNetwork === true;
  const { data: sandboxCapability, mutate: revalidateSandboxCapability } =
    useLocalSandboxCapability();
  const canUseLocalSandbox = sandboxCapability?.available === true;

  // The desktop downgrades its own verdict when a fence fails to establish (the
  // cheap probe can't see that far), so re-ask each time the picker opens
  // instead of showing a stale "available" for the rest of the session.
  useEffect(() => {
    if (!isDesktop || !open) return;
    void revalidateSandboxCapability();
  }, [open, revalidateSandboxCapability]);

  const selectExecutionTarget = useSelectExecutionTarget(agentId);
  const { selectTarget, topicDeviceId } = useTopicAwareTargetSelect({
    agentId,
    currentDeviceId,
    devices,
    selectExecutionTarget,
    topicId,
  });

  const handleSelect = useCallback(
    async (target: DeviceExecutionTarget, deviceId?: string, localSandbox?: boolean) => {
      setOpen(false);
      await selectTarget(target, deviceId, localSandbox);
    },
    [selectTarget],
  );

  // Setting up the backend raises an elevation prompt and creates a dedicated
  // OS account, so it only ever happens on this explicit click. The popover
  // stays open throughout — the user came here to pick an environment, and the
  // row turning usable is the answer to what they clicked.
  const [isInstallingSandbox, setIsInstallingSandbox] = useState(false);
  const handleInstallSandbox = useCallback(async () => {
    setIsInstallingSandbox(true);
    try {
      const result = await localFileService.installSandbox();
      // The IPC already re-probed, so trust its verdict rather than firing
      // another round-trip. A cancelled prompt lands here too, with the
      // unchanged capability — nothing to report, the user just said no.
      await revalidateSandboxCapability(result.capability, { revalidate: false });
    } finally {
      setIsInstallingSandbox(false);
    }
  }, [revalidateSandboxCapability]);

  // Toggling the network does NOT change which environment is selected — same
  // dormant semantics the sandbox flag itself has when another environment is
  // active, so the popover stays open and nothing is switched behind the user.
  // Saved on the unpinned default, never the open topic's machine.
  const handleToggleSandboxNetwork = useSandboxNetworkToggle({
    agentId,
    deviceRoutingAvailable,
    isHetero,
    selectExecutionTarget,
  });

  // Auto-default to THIS desktop's local execution on first open, for both
  // personal and workspace agents (workspace behaviour used to be a hostname
  // lookup against the workspace device pool — see — but with
  // per-user overrides that lookup is unnecessary: `useSelectExecutionTarget`
  // resolves `'local'` to this desktop's personal gateway `deviceId` and, for
  // a workspace agent, persists it into `users.preference.agentDeviceOverrides`,
  // so it never touches other members' choices).
  //
  // Fires only when the effective (merged) target and bound device are both
  // unset — an explicit prior selection, mine or (for personal) shared,
  // is preserved. Waits for the workspace preference fetch to settle first:
  // before it returns, an existing per-user override looks unset and the
  // default would clobber it.
  useEffect(() => {
    if (!isDesktop) return;
    if (!canShowExecutionTargetSelector) return;
    if (isWorkspacePreferenceLoading) return;
    if (agencyConfig?.executionTarget !== undefined) return;
    if (agencyConfig?.boundDeviceId !== undefined) return;
    if (!currentDeviceId) return;
    // `silent`: this is a mount-time default, so a rejected write must not
    // surface a save-failure toast on an agent the user only opened.
    void selectExecutionTarget('local', undefined, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    agencyConfig?.executionTarget,
    agencyConfig?.boundDeviceId,
    currentDeviceId,
    canShowExecutionTargetSelector,
    isWorkspacePreferenceLoading,
  ]);

  const boundDevice =
    canShowExecutionTargetSelector && executionTarget === 'device'
      ? devices?.find((d) => d.deviceId === boundDeviceId)
      : undefined;
  // Only a picked remote device; the local machine is the one already in front of the user.
  const load = useDeviceLoad(topicDeviceUnknown ? undefined : boundDevice);

  if (!canShowExecutionTarget) return null;

  // The picker splits by whether the caller is inside a workspace agent:
  // - **Personal agent** — flat list of the caller's personal-scope devices
  //   only; never `scope: 'workspace'` rows (no workspace context here).
  // - **Workspace agent** — `Private` / `Workspace` groups by workspace-scope
  //   visibility, dropping `scope: 'personal'`: personal devices run under a
  //   different identity (`sha256(machineUUID + userId)` vs
  //   `sha256(machineUUID + workspace:<id>)`), and the `local` chip already
  //   covers "run on my machine" as a per-user override.
  //
  // Naming — Personal is reserved for the account-tier concept; workspace
  // groupings say Private/Workspace (私人/工作区) instead.
  const { personal, privateWorkspace, workspace } = groupExecutionTargetDevices(devices);
  const privateDevices = isWorkspaceAgent ? privateWorkspace : [];
  const workspaceDevices = isWorkspaceAgent ? workspace : [];
  const personalOnlyDevices = isWorkspaceAgent ? [] : personal;
  // Workspace agents always render the Private / Workspace group split (even
  // when one side is empty — the labels tell the user which pool they're
  // looking at). Personal mode stays flat.
  const showDeviceGroups = isWorkspaceAgent;

  // Empty-state accounting must use the rows the CURRENT agent can actually
  // pick (post scope filtering) — a workspace agent whose members only have
  // personal devices would otherwise render neither devices nor an empty state.
  // The pool rule itself lives in `devicePoolForAgent`, shared with every other
  // surface that lists devices for an agent (e.g. the Task run-location chip).
  const deviceRows = devicePoolForAgent(devices, isWorkspaceAgent);
  // Only a server-confirmed list can say the pool is empty: a stored copy may
  // lack this pool's rows (stale, or past the persisted-row cap).
  const poolStatus = getDevicePoolStatus({
    error: deviceListError,
    isConfirmed: isDeviceListConfirmed,
    isValidating: isDeviceListValidating,
    rowCount: deviceRows.length,
  });
  const isPoolEmpty = poolStatus === 'empty';
  // On web with no device, the prominent download card below replaces the small
  // header link — avoid showing the same CTA twice. Workspace agents get the
  // enroll hint instead: downloading the desktop app wouldn't help until the
  // machine is enrolled into the workspace pool.
  const showWebDownloadCard = !isDesktop && !isWorkspaceAgent && isPoolEmpty;
  const showWorkspaceEnrollHint = isWorkspaceAgent && isPoolEmpty;

  // Compute chip
  let chipIcon: ReactNode = <ExecutionTargetIcon target={'sandbox'} />;
  let chipLabel = t('heteroAgent.executionTarget.sandbox');
  if (chipExecutionTarget === 'none') {
    chipIcon = <ExecutionTargetIcon target={'none'} />;
    chipLabel = t('heteroAgent.executionTarget.none');
  } else if (chipExecutionTarget === 'auto') {
    chipIcon = <ExecutionTargetIcon target={'auto'} />;
    chipLabel = t('heteroAgent.executionTarget.auto');
  } else if (chipExecutionTarget === 'local') {
    // 本机始终使用通用的本地电脑图标，不区分具体平台
    chipIcon = <ExecutionTargetIcon target={canShowExecutionTargetSelector ? 'local' : 'device'} />;
    chipLabel = t(
      canShowExecutionTargetSelector
        ? 'heteroAgent.executionTarget.local'
        : 'heteroAgent.executionTarget.workspaceGroup',
    );
    // A fenced run looks identical to an unfenced one until a command fails, so
    // the chip — the only always-visible surface — has to say which it is.
    if (canShowExecutionTargetSelector && localSandboxEnabled) {
      chipIcon = <Icon icon={ShieldCheckIcon} size={14} />;
      chipLabel = t('heteroAgent.executionTarget.localSandbox');
    }
  } else if (chipExecutionTarget === 'device') {
    chipIcon = <ExecutionTargetIcon devicePlatform={boundDevice?.platform} target={'device'} />;
    chipLabel = canShowExecutionTargetSelector
      ? (boundDevice?.friendlyName ??
        boundDevice?.hostname ??
        t('heteroAgent.executionTarget.unknownDevice'))
      : t('heteroAgent.executionTarget.workspaceGroup');
  }
  // A cwd with no recorded machine: naming the agent default here would pair
  // it with a path that may live on another computer.
  const isMachineChip = chipExecutionTarget === 'local' || chipExecutionTarget === 'device';
  if (topicDeviceUnknown && canShowExecutionTargetSelector && isMachineChip) {
    chipIcon = <ExecutionTargetIcon target={'device'} />;
    chipLabel = t('heteroAgent.executionTarget.unknownDevice');
  }

  // Tag the row that runs this topic, so it reads as the conversation's own
  // machine rather than the agent default. A `fixed` target may point
  // elsewhere, in which case nothing is tagged.
  const effectiveMachineId =
    executionTarget === 'device'
      ? boundDeviceId
      : executionTarget === 'local'
        ? (currentDeviceId ?? boundDeviceId)
        : undefined;
  const topicTag =
    topicDeviceId && effectiveMachineId === topicDeviceId
      ? t('heteroAgent.executionTarget.topicTag')
      : undefined;
  const tagsFor = (active: boolean, tags: ReactNode[] = []) =>
    active && topicTag ? [...tags, topicTag] : tags;

  const isActive = (target: DeviceExecutionTarget, deviceId?: string) => {
    if (target === 'device') return executionTarget === 'device' && boundDeviceId === deviceId;
    // The two local rows share one target and are told apart by the sandbox
    // flag, so neither may claim the checkmark on the other's behalf.
    if (target === 'local') return executionTarget === 'local' && !localSandboxEnabled;
    return executionTarget === target;
  };

  const renderDeviceRow = (d: NonNullable<typeof devices>[number]) => {
    const isCurrentMachine = d.deviceId === currentDeviceId;
    return (
      <DeviceOptionRow
        active={isActive('device', d.deviceId)}
        device={d}
        isCurrentMachine={isCurrentMachine}
        key={d.deviceId}
        reconnecting={reconnectingDeviceId === d.deviceId}
        tags={tagsFor(
          isActive('device', d.deviceId),
          isCurrentMachine ? [t('heteroAgent.executionTarget.gateway')] : [],
        )}
        onReconnect={() => void handleReconnectDevice(d.deviceId)}
        onSelect={() => void handleSelect('device', d.deviceId)}
      />
    );
  };

  const content = (
    <Flexbox style={{ maxWidth: 320, minWidth: 280 }}>
      <div {...stylex.props(styles.header)}>
        <Flexbox horizontal align={'center'} gap={4}>
          <span {...stylex.props(styles.headerTitle)}>
            {t('heteroAgent.executionTarget.title')}
          </span>
          <Tooltip title={t('heteroAgent.executionTarget.infoTooltip')}>
            <span {...stylex.props(styles.headerInfo)}>
              <Icon icon={InfoIcon} size={12} />
            </span>
          </Tooltip>
        </Flexbox>
        {isDesktop || showWebDownloadCard ? (
          <button
            {...stylex.props(styles.manageButton)}
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/settings/devices');
            }}
          >
            <Icon icon={SettingsIcon} size={11} />
            <span>{t('heteroAgent.executionTarget.manage')}</span>
          </button>
        ) : (
          <a
            {...stylex.props(styles.headerLink)}
            href={DOWNLOAD_URL.default}
            rel="noreferrer"
            target="_blank"
          >
            <Icon icon={ExternalLinkIcon} size={11} />
            <span>{t('heteroAgent.executionTarget.downloadDesktop')}</span>
          </a>
        )}
      </div>
      {isHetero ? null : (
        <OptionRow
          active={isActive('none')}
          desc={t('heteroAgent.executionTarget.noneDesc')}
          icon={<ExecutionTargetIcon target={'none'} />}
          label={t('heteroAgent.executionTarget.none')}
          onClick={() => void handleSelect('none')}
        />
      )}
      {isHetero ? null : (
        <OptionRow
          active={isActive('auto')}
          desc={t('heteroAgent.executionTarget.autoDesc')}
          icon={<ExecutionTargetIcon target={'auto'} />}
          label={t('heteroAgent.executionTarget.auto')}
          onClick={() => void handleSelect('auto')}
        />
      )}
      {/* `local` pins this desktop's personal `deviceId`. Available in both
          personal and workspace modes now : a workspace-agent
          `local` pick lands in `users.preference.agentDeviceOverrides` — my
          per-user override — so it never binds the workspace-shared
          `agencyConfig` or coerces any other member's dispatch. */}
      {isDesktop ? (
        <OptionRow
          active={isActive('local')}
          desc={t('heteroAgent.executionTarget.localDesc')}
          icon={<ExecutionTargetIcon target={'local'} />}
          // 本机统一显示「本地设备」，不再带具体设备名称
          label={t('heteroAgent.executionTarget.local')}
          tags={tagsFor(isActive('local'))}
          onClick={() => void handleSelect('local', undefined, false)}
        />
      ) : null}
      {/* Same machine as the row above, fenced: writes confined to the working
          directory, network denied unless the switch opens the registry
          allowlist. Shown even when the host can't provide a sandbox — disabled,
          carrying the real reason, because "unavailable" here usually means
          "not installed yet" and silently hiding the feature would strand the
          user with no way to find out why. */}
      {isDesktop ? (
        <OptionRow
          active={executionTarget === 'local' && localSandboxEnabled}
          disabled={!canUseLocalSandbox}
          icon={<Icon icon={ShieldCheckIcon} size={14} />}
          label={t('heteroAgent.executionTarget.localSandbox')}
          tags={tagsFor(executionTarget === 'local' && localSandboxEnabled)}
          desc={
            canUseLocalSandbox
              ? t(
                  localSandboxNetwork
                    ? 'heteroAgent.executionTarget.localSandboxDescNetwork'
                    : 'heteroAgent.executionTarget.localSandboxDesc',
                )
              : // Prefer the actionable instruction (Linux's "install this
                // package") over the backend's raw diagnostic when we have one.
                (sandboxCapability?.instructions ??
                t('heteroAgent.executionTarget.localSandboxUnavailable', {
                  reason: sandboxCapability?.reason ?? '',
                }))
          }
          extra={
            canUseLocalSandbox ? (
              <>
                <InstantSwitch
                  enabled={localSandboxNetwork}
                  size={'small'}
                  onChange={handleToggleSandboxNetwork}
                />
                <Tooltip title={t('heteroAgent.executionTarget.localSandboxNetworkTip')}>
                  <span {...stylex.props(styles.extraInfo)}>
                    <Icon icon={InfoIcon} size={12} />
                  </span>
                </Tooltip>
              </>
            ) : sandboxCapability?.canInstall ? (
              // The backend is missing but we can provision it — a dead-end row
              // would leave the user to discover a CLI incantation on their own.
              <Button loading={isInstallingSandbox} size={'small'} onClick={handleInstallSandbox}>
                {t('heteroAgent.executionTarget.localSandboxSetUp')}
              </Button>
            ) : undefined
          }
          onClick={() => void handleSelect('local', undefined, true)}
        />
      ) : null}
      <OptionRow
        active={isActive('sandbox')}
        disabled={!supportsSandbox}
        icon={<ExecutionTargetIcon target={'sandbox'} />}
        label={t('heteroAgent.executionTarget.sandbox')}
        desc={t(
          supportsSandbox
            ? 'heteroAgent.executionTarget.sandboxDesc'
            : 'heteroAgent.executionTarget.sandboxUnsupported',
          { name: heteroType ? HETEROGENEOUS_TYPE_LABELS[heteroType] : undefined },
        )}
        onClick={() => void handleSelect('sandbox')}
      />
      {deviceRows.length > 0 ? (
        showDeviceGroups ? (
          <>
            {privateDevices.length > 0 ? (
              <>
                <div {...stylex.props(styles.groupLabel)}>
                  {t('heteroAgent.executionTarget.personalGroup')}
                </div>
                <div {...stylex.props(styles.deviceList)}>
                  {privateDevices.map((d) => renderDeviceRow(d))}
                </div>
              </>
            ) : null}
            {workspaceDevices.length > 0 ? (
              <>
                <div {...stylex.props(styles.groupLabel)}>
                  {t('heteroAgent.executionTarget.workspaceGroup')}
                </div>
                <div {...stylex.props(styles.deviceList)}>
                  {workspaceDevices.map((d) => renderDeviceRow(d))}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <div {...stylex.props(styles.deviceList)}>
            {personalOnlyDevices.map((d) => renderDeviceRow(d))}
          </div>
        )
      ) : null}
      {poolStatus === 'loading' ? (
        <div {...stylex.props(styles.empty)}>{t('heteroAgent.executionTarget.loading')}</div>
      ) : null}
      {poolStatus === 'error' ? (
        <div {...stylex.props(styles.empty)}>
          {t('heteroAgent.executionTarget.loadFailed')}{' '}
          <a
            role="button"
            onClick={() => {
              void refreshDevices();
            }}
          >
            {t('retry', { ns: 'common' })}
          </a>
        </div>
      ) : null}
      {/* Workspace agent with no workspace device: personal machines are
          suppressed above, so guide the user to enroll one into the shared
          pool instead of showing a bare menu. */}
      {showWorkspaceEnrollHint ? (
        <div {...stylex.props(styles.empty)}>
          {t('heteroAgent.executionTarget.noWorkspaceDevices', {
            cmd: `lh connect --workspace ${agentWorkspaceId}`,
          })}
        </div>
      ) : null}
      {/* On web with no remote device, guide the user to the desktop app (which
          unlocks local execution + `lh connect`) rather than a muted dead-end. */}
      {showWebDownloadCard ? (
        <a
          {...stylex.props(styles.downloadCard)}
          href={DOWNLOAD_URL.default}
          rel="noreferrer"
          target="_blank"
        >
          <div {...stylex.props(styles.optionIcon)}>
            <Icon icon={MonitorDownIcon} size={14} />
          </div>
          <div {...stylex.props(styles.optionMeta)}>
            <div {...stylex.props(styles.optionTitle)}>
              {t('heteroAgent.executionTarget.downloadDesktopTitle')}
            </div>
            <div {...stylex.props(styles.desc)}>
              {t('heteroAgent.executionTarget.downloadDesktopDesc')}
            </div>
          </div>
          <Icon
            className={stylex.props(styles.downloadCardArrow).className}
            icon={ExternalLinkIcon}
            size={13}
          />
        </a>
      ) : null}
      {isPoolEmpty && isDesktop && !isWorkspaceAgent ? (
        <div {...stylex.props(styles.empty)}>{t('heteroAgent.executionTarget.noDevices')}</div>
      ) : null}
    </Flexbox>
  );

  const chip = (
    <div {...stylex.props(styles.button, !canShowExecutionTargetSelector && styles.buttonReadonly)}>
      {chipIcon}
      <span {...stylex.props(styles.buttonLabel)}>{chipLabel}</span>
      {load && <DeviceLoadMeter load={load} />}
      {canShowExecutionTargetSelector ? <Icon icon={ChevronDownIcon} size={12} /> : null}
    </div>
  );

  // Locked: reaching here with the chip visible means the author fixed the
  // execution target in the Agent Profile (a member without use access never
  // renders the chip at all), so name the environment and say why it's pinned
  // instead of leaving an inert label.
  if (!canShowExecutionTargetSelector)
    return (
      <Tooltip
        title={formatLockedControlTooltip(chipLabel, t('heteroAgent.executionTarget.fixedTip'))}
      >
        {chip}
      </Tooltip>
    );

  return (
    <Popover
      content={content}
      open={open}
      placement="topLeft"
      styles={{ content: { padding: 4 } }}
      trigger="click"
      onOpenChange={setOpen}
    >
      {/* A stable wrapper, so adding the load tooltip never swaps the popover's anchor. */}
      <div>{open || !load ? chip : <Tooltip title={load.summary}>{chip}</Tooltip>}</div>
    </Popover>
  );
});

HeteroDeviceSwitcher.displayName = 'HeteroDeviceSwitcher';

export default HeteroDeviceSwitcher;
