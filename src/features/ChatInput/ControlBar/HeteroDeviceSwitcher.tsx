'use client';

import { isDesktop } from '@lobechat/const';
import {
  HETEROGENEOUS_TYPE_LABELS,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import type { DeviceExecutionTarget } from '@lobechat/types';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  InfoIcon,
  MonitorDownIcon,
  SettingsIcon,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DOWNLOAD_URL } from '@/const/url';
import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import { useSelectExecutionTarget } from '@/features/ChatInput/hooks/useSelectExecutionTarget';
import { useDeviceList } from '@/features/DeviceManager/useDeviceList';
import {
  ExecutionTargetDeviceStatus,
  ExecutionTargetIcon,
  groupExecutionTargetDevices,
} from '@/features/ExecutionTargetPicker';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import {
  isHeterogeneousSandboxExecutionAvailable,
  resolveExecutionTarget,
} from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { useElectronStore } from '@/store/electron';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    height: 28px;
    padding-inline: 8px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  buttonLabel: css`
    overflow: hidden;
    max-width: 120px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  buttonReadonly: css`
    cursor: default;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: transparent;
    }
  `,
  check: css`
    flex: none;
    margin-inline-start: auto;
    color: ${cssVar.colorPrimary};
  `,
  desc: css`
    display: flex;
    gap: 6px;
    align-items: center;

    font-size: 11px;
    color: ${cssVar.colorTextDescription};
  `,
  deviceList: css`
    overflow-y: auto;

    /* Cap the device section so a long list (servers/CLI fleets) stays scrollable
       inside the popover instead of growing past the viewport. */
    max-height: 240px;

    /* Room for the scrollbar so rows don't sit flush against it. */
    margin-inline-end: -4px;
    padding-inline-end: 4px;
  `,
  empty: css`
    padding-block: 8px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  downloadCard: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    text-decoration: none;

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  downloadCardArrow: css`
    flex: none;
    margin-inline-start: auto;
    color: ${cssVar.colorTextQuaternary};
  `,
  option: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  optionActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
  optionDisabled: css`
    cursor: not-allowed;
    opacity: 0.55;

    &:hover {
      background: transparent;
    }
  `,
  optionIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgElevated};
  `,
  optionMeta: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;

    min-width: 0;
  `,
  optionTitle: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tag: css`
    flex: none;

    padding-block: 0;
    padding-inline: 5px;
    border-radius: 4px;

    font-size: 10px;
    line-height: 16px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  header: css`
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: space-between;

    padding-block: 6px 4px;
    padding-inline: 8px;
  `,
  headerInfo: css`
    cursor: help;
    color: ${cssVar.colorTextQuaternary};
    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  headerLink: css`
    display: flex;
    gap: 3px;
    align-items: center;

    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
    text-decoration: none;

    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  headerTitle: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  manageButton: css`
    cursor: pointer;

    display: flex;
    gap: 3px;
    align-items: center;

    padding: 0;
    border: none;

    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};

    background: none;

    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  groupLabel: css`
    padding-block: 4px;
    padding-inline: 8px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextQuaternary};
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `,
}));

interface OptionRowProps {
  active: boolean;
  desc?: ReactNode;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tag?: ReactNode;
}

const OptionRow = memo<OptionRowProps>(({ active, desc, disabled, icon, label, onClick, tag }) => {
  return (
    <div
      className={cx(
        styles.option,
        active && styles.optionActive,
        disabled && styles.optionDisabled,
      )}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      <div className={styles.optionIcon}>{icon}</div>
      <div className={styles.optionMeta}>
        <Flexbox horizontal align={'center'} gap={6}>
          <span className={styles.optionTitle}>{label}</span>
          {tag ? <span className={styles.tag}>{tag}</span> : null}
        </Flexbox>
        {desc ? <div className={styles.desc}>{desc}</div> : null}
      </div>
      {active ? <Icon className={styles.check} icon={CheckIcon} size={14} /> : null}
    </div>
  );
});

OptionRow.displayName = 'HeteroDeviceSwitcher.OptionRow';

interface HeteroDeviceSwitcherProps {
  agentId: string;
}

const HeteroDeviceSwitcher = memo<HeteroDeviceSwitcherProps>(({ agentId }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const navigate = useWorkspaceAwareNavigate();
  const { canUseResource } = useChatInputResourceAccess();

  const agentWorkspaceId = useAgentStore((s) => s.agentMap[agentId]?.workspaceId);
  const isWorkspaceAgent = Boolean(agentWorkspaceId);

  // Shared config merged with the caller's per-agent override (LOBE-11689) —
  // the hook eagerly fetches the `workspaceUserSettings` bucket on mount so
  // what the picker shows and what dispatch will actually do always agree.
  const {
    agencyConfig,
    canDisplayExecutionTarget,
    canSelectExecutionTarget,
    isPreferenceLoading: isWorkspacePreferenceLoading,
    workspaceScoped,
  } = useEffectiveAgencyConfig(agentId);
  const canShowExecutionTarget = canUseResource && canDisplayExecutionTarget;
  const canShowExecutionTargetSelector = canShowExecutionTarget && canSelectExecutionTarget;

  const heteroType = agencyConfig?.heterogeneousProvider?.type;
  const boundDeviceId = agencyConfig?.boundDeviceId;

  // Local heterogeneous agents (remote types already early-return
  // below) bring their own toolchain and must execute somewhere, so `'none'`
  // (plain chat, no execution environment) isn't a valid target for them: hide
  // the option and never fall back to / honour a stale stored `'none'`.
  const isHetero = !!heteroType;
  const supportsSandbox = isHeterogeneousSandboxExecutionAvailable(heteroType);

  // Workspace-keyed SWR fetch — the raw lambdaQuery key has no workspace
  // dimension, so the picker kept showing the previous workspace's pool after
  // a switch (LOBE-11904).
  const { data: devices, isLoading } = useDeviceList();

  // The current machine's own gateway deviceId (desktop only), used to badge the
  // matching device row with a "This device" tag and show the local-process
  // description instead of the generic online/offline status.
  useElectronStore((s) => s.useFetchGatewayDeviceInfo)();
  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  const currentDeviceId = isDesktop ? gatewayDeviceInfo?.deviceId : undefined;

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

  const selectExecutionTarget = useSelectExecutionTarget(agentId);
  const handleSelect = useCallback(
    async (target: DeviceExecutionTarget, deviceId?: string) => {
      setOpen(false);
      await selectExecutionTarget(target, deviceId);
    },
    [selectExecutionTarget],
  );

  // Auto-default to THIS desktop's local execution on first open, for both
  // personal and workspace agents (workspace behaviour used to be a hostname
  // lookup against the workspace device pool — see LOBE-11647 — but with
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
    void selectExecutionTarget('local');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    agencyConfig?.executionTarget,
    agencyConfig?.boundDeviceId,
    currentDeviceId,
    canShowExecutionTargetSelector,
    isWorkspacePreferenceLoading,
  ]);

  // Don't render for remote hetero agents — they use RemoteAgentConfigCard in profile.
  if (heteroType && isRemoteHeterogeneousType(heteroType)) return null;
  if (!canShowExecutionTarget) return null;

  const boundDevice =
    canShowExecutionTargetSelector && executionTarget === 'device'
      ? devices?.find((d) => d.deviceId === boundDeviceId)
      : undefined;

  // The picker splits by whether the caller is inside a workspace agent:
  //
  // - **Personal agent** — flat list of the caller's personal-scope devices
  //   only; there is no workspace context so no group split makes sense.
  //   Never show `scope: 'workspace'` rows here (they belong to a workspace
  //   the personal-mode agent has nothing to do with).
  //
  // - **Workspace agent** — split into `Private` and `Workspace` groups by
  //   workspace-scope visibility, and drop `scope: 'personal'` entirely.
  //   Personal devices are the caller's account-tier machines: they belong
  //   to a different identity than the workspace agent runs under
  //   (per-user `sha256(machineUUID + userId)` vs
  //   `sha256(machineUUID + workspace:<id>)`), so binding one to a workspace
  //   agent conflates identities. The `local` chip already covers "run on my
  //   machine" as a per-user override (LOBE-11689) without needing to expose
  //   the raw personal deviceId.
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
  const deviceRows = isWorkspaceAgent
    ? [...privateDevices, ...workspaceDevices]
    : [...personalOnlyDevices];
  const hasNoDevices = deviceRows.length === 0;
  // On web with no device, the prominent download card below replaces the small
  // header link — avoid showing the same CTA twice. Workspace agents get the
  // enroll hint instead: downloading the desktop app wouldn't help until the
  // machine is enrolled into the workspace pool.
  const showWebDownloadCard = !isDesktop && !isWorkspaceAgent && hasNoDevices && !isLoading;
  const showWorkspaceEnrollHint = isWorkspaceAgent && hasNoDevices && !isLoading;

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
  } else if (chipExecutionTarget === 'device') {
    chipIcon = <ExecutionTargetIcon devicePlatform={boundDevice?.platform} target={'device'} />;
    chipLabel = canShowExecutionTargetSelector
      ? (boundDevice?.friendlyName ??
        boundDevice?.hostname ??
        t('heteroAgent.executionTarget.unknownDevice'))
      : t('heteroAgent.executionTarget.workspaceGroup');
  }

  const isActive = (target: DeviceExecutionTarget, deviceId?: string) => {
    if (target === 'device') return executionTarget === 'device' && boundDeviceId === deviceId;
    return executionTarget === target;
  };

  const renderDeviceStatus = (d: NonNullable<typeof devices>[number]) => (
    <ExecutionTargetDeviceStatus
      offlineLabel={t('heteroAgent.executionTarget.offline')}
      online={d.online}
      onlineLabel={t('heteroAgent.executionTarget.online')}
    />
  );

  const renderDeviceRow = (d: NonNullable<typeof devices>[number]) => {
    const isCurrentMachine = d.deviceId === currentDeviceId;
    return (
      <OptionRow
        active={isActive('device', d.deviceId)}
        disabled={!d.online}
        icon={<ExecutionTargetIcon devicePlatform={d.platform} target={'device'} />}
        key={d.deviceId}
        label={d.friendlyName || d.hostname || d.deviceId}
        tag={isCurrentMachine ? t('heteroAgent.executionTarget.gateway') : undefined}
        desc={
          isCurrentMachine ? t('heteroAgent.executionTarget.gatewayDesc') : renderDeviceStatus(d)
        }
        onClick={() => void handleSelect('device', d.deviceId)}
      />
    );
  };

  const content = (
    <Flexbox gap={6} style={{ maxWidth: 320, minWidth: 280 }}>
      <div className={styles.header}>
        <Flexbox horizontal align={'center'} gap={4}>
          <span className={styles.headerTitle}>{t('heteroAgent.executionTarget.title')}</span>
          <Tooltip title={t('heteroAgent.executionTarget.infoTooltip')}>
            <span className={styles.headerInfo}>
              <Icon icon={InfoIcon} size={12} />
            </span>
          </Tooltip>
        </Flexbox>
        {isDesktop || showWebDownloadCard ? (
          <button
            className={styles.manageButton}
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
            className={styles.headerLink}
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
          personal and workspace modes now (LOBE-11689): a workspace-agent
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
          onClick={() => void handleSelect('local')}
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
        <div className={styles.deviceList}>
          {showDeviceGroups ? (
            <>
              {privateDevices.length > 0 ? (
                <>
                  <div className={styles.groupLabel}>
                    {t('heteroAgent.executionTarget.personalGroup')}
                  </div>
                  {privateDevices.map((d) => renderDeviceRow(d))}
                </>
              ) : null}
              {workspaceDevices.length > 0 ? (
                <>
                  <div className={styles.groupLabel}>
                    {t('heteroAgent.executionTarget.workspaceGroup')}
                  </div>
                  {workspaceDevices.map((d) => renderDeviceRow(d))}
                </>
              ) : null}
            </>
          ) : (
            personalOnlyDevices.map((d) => renderDeviceRow(d))
          )}
        </div>
      ) : null}
      {hasNoDevices && isLoading ? (
        <div className={styles.empty}>{t('heteroAgent.executionTarget.loading')}</div>
      ) : null}
      {/* Workspace agent with no workspace device: personal machines are
          suppressed above, so guide the user to enroll one into the shared
          pool instead of showing a bare menu. */}
      {showWorkspaceEnrollHint ? (
        <div className={styles.empty}>
          {t('heteroAgent.executionTarget.noWorkspaceDevices', {
            cmd: `lh connect --workspace ${agentWorkspaceId}`,
          })}
        </div>
      ) : null}
      {/* On web with no remote device, guide the user to the desktop app (which
          unlocks local execution + `lh connect`) rather than a muted dead-end. */}
      {showWebDownloadCard ? (
        <a
          className={styles.downloadCard}
          href={DOWNLOAD_URL.default}
          rel="noreferrer"
          target="_blank"
        >
          <div className={styles.optionIcon}>
            <Icon icon={MonitorDownIcon} size={14} />
          </div>
          <div className={styles.optionMeta}>
            <div className={styles.optionTitle}>
              {t('heteroAgent.executionTarget.downloadDesktopTitle')}
            </div>
            <div className={styles.desc}>
              {t('heteroAgent.executionTarget.downloadDesktopDesc')}
            </div>
          </div>
          <Icon className={styles.downloadCardArrow} icon={ExternalLinkIcon} size={13} />
        </a>
      ) : null}
      {hasNoDevices && !isLoading && isDesktop && !isWorkspaceAgent ? (
        <div className={styles.empty}>{t('heteroAgent.executionTarget.noDevices')}</div>
      ) : null}
    </Flexbox>
  );

  const chip = (
    <div className={cx(styles.button, !canShowExecutionTargetSelector && styles.buttonReadonly)}>
      {chipIcon}
      <span className={styles.buttonLabel}>{chipLabel}</span>
      {canShowExecutionTargetSelector ? <Icon icon={ChevronDownIcon} size={12} /> : null}
    </div>
  );

  if (!canShowExecutionTargetSelector) return chip;

  return (
    <Popover
      content={content}
      open={open}
      placement="topLeft"
      styles={{ content: { padding: 4 } }}
      trigger="click"
      onOpenChange={setOpen}
    >
      {chip}
    </Popover>
  );
});

HeteroDeviceSwitcher.displayName = 'HeteroDeviceSwitcher';

export default HeteroDeviceSwitcher;
