'use client';

import { SiApple, SiLinux } from '@icons-pack/react-simple-icons';
import { isDesktop } from '@lobechat/const';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type { DeviceExecutionTarget } from '@lobechat/types';
import { Microsoft } from '@lobehub/icons';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  BoxIcon,
  CheckIcon,
  ChevronDownIcon,
  InfoIcon,
  LaptopIcon,
  MonitorIcon,
  MonitorOffIcon,
  SettingsIcon,
  SparklesIcon,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { lambdaQuery } from '@/libs/trpc/client';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
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
  dotOffline: css`
    flex: none;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorTextQuaternary};
  `,
  dotOnline: css`
    flex: none;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
    box-shadow: 0 0 0 2px ${cssVar.colorSuccessBg};
  `,
  empty: css`
    padding-block: 8px;
    padding-inline: 8px;
    font-size: 12px;
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
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};

    background: none;

    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorTextSecondary};
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

const getDeviceIcon = (platform: string | null | undefined, size = 14): ReactNode => {
  switch (platform) {
    case 'darwin': {
      return <SiApple color="currentColor" size={size} />;
    }
    case 'linux': {
      return <SiLinux color="currentColor" size={size} />;
    }
    case 'win32': {
      return <Microsoft color="currentColor" size={size} />;
    }
    default: {
      return <Icon icon={MonitorIcon} size={size} />;
    }
  }
};

interface HeteroDeviceSwitcherProps {
  agentId: string;
}

const HeteroDeviceSwitcher = memo<HeteroDeviceSwitcherProps>(({ agentId }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const navigate = useWorkspaceAwareNavigate();

  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  const heteroType = agencyConfig?.heterogeneousProvider?.type;
  const boundDeviceId = agencyConfig?.boundDeviceId;
  const isRemoteHetero = heteroType ? isRemoteHeterogeneousType(heteroType) : false;

  // Heterogeneous agents (Claude Code / Codex — remote types already early-return
  // below) bring their own toolchain and must execute somewhere, so `'none'`
  // (plain chat, no execution environment) isn't a valid target for them: hide
  // the option and never fall back to / honour a stale stored `'none'`.
  const isHetero = !!heteroType;

  const { data: devices, isLoading } = lambdaQuery.device.listDevices.useQuery(undefined, {
    staleTime: 30_000,
  });

  // The current machine's Device Connection id (desktop only). The desktop
  // picker shows this machine once as the dedicated local option, but we still
  // persist the id with that local choice so web/mobile can resolve it back to
  // this concrete connected device instead of falling back to the sandbox.
  useElectronStore((s) => s.useFetchGatewayDeviceInfo)();
  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  const currentDeviceId = isDesktop ? gatewayDeviceInfo?.deviceId : undefined;

  // Effective target: shared with server dispatch. In particular, a desktop
  // "local" selection that carries this desktop's boundDeviceId becomes a
  // device target when the same agent is opened from web.
  const executionTarget = resolveExecutionTarget(agencyConfig, {
    isHetero,
    clientExecutionAvailable: isDesktop,
  });

  const handleSelect = useCallback(
    async (target: DeviceExecutionTarget, deviceId?: string) => {
      setOpen(false);

      // `executionTarget` is the single source of truth — the server tool
      // gate + client `getRuntimeModeById` derive `runtimeMode` from it.
      let nextBoundDeviceId = target === 'device' ? deviceId : boundDeviceId;
      if (target === 'local') {
        // Desktop local execution is selected by location ("this machine"), not
        // by transport. Store the machine's connected-device id anyway so the
        // same agent opened outside desktop knows which device "local" referred
        // to and can display/route that selection as `device` there.
        nextBoundDeviceId = currentDeviceId;
        if (!nextBoundDeviceId) {
          try {
            nextBoundDeviceId = (await gatewayConnectionService.getDeviceInfo())?.deviceId;
          } catch {
            nextBoundDeviceId = undefined;
          }
        }
        if (isHetero && !nextBoundDeviceId) return;
      }

      await updateAgentConfigById(agentId, {
        agencyConfig: {
          ...agencyConfig,
          executionTarget: target,
          ...(nextBoundDeviceId ? { boundDeviceId: nextBoundDeviceId } : {}),
        },
      });
    },
    [agentId, agencyConfig, boundDeviceId, currentDeviceId, isHetero, updateAgentConfigById],
  );

  useEffect(() => {
    if (
      !isDesktop ||
      isRemoteHetero ||
      !currentDeviceId ||
      agencyConfig?.executionTarget !== 'device' ||
      boundDeviceId !== currentDeviceId
    ) {
      return;
    }

    // Historical/cross-client configs may store this desktop as an explicit
    // `device` target. In the desktop picker we show the current machine only
    // once as `local`, so normalize that equivalent location instead of adding
    // a duplicate "same machine via Device Connection" row just to mark it
    // selected.
    void updateAgentConfigById(agentId, {
      agencyConfig: { ...agencyConfig, boundDeviceId: currentDeviceId, executionTarget: 'local' },
    });
  }, [
    agentId,
    agencyConfig,
    boundDeviceId,
    currentDeviceId,
    isRemoteHetero,
    updateAgentConfigById,
  ]);

  // Don't render for remote hetero agents — they use RemoteAgentConfigCard in profile.
  if (isRemoteHetero) return null;

  const boundDevice =
    executionTarget === 'device' ? devices?.find((d) => d.deviceId === boundDeviceId) : undefined;
  const currentDevice = devices?.find((d) => d.deviceId === currentDeviceId);
  const deviceRows = devices ?? [];
  // Avoid showing the same execution location twice on desktop. The current
  // machine is already represented by the local option above; the connected
  // device list is for other machines. Cross-client continuity is handled by the
  // `boundDeviceId` stored with local selections, not by exposing a duplicate
  // "same machine through Device Connection" row here.
  const visibleDeviceRows = currentDeviceId
    ? deviceRows.filter((device) => device.deviceId !== currentDeviceId)
    : deviceRows;
  const hasNoDevices = deviceRows.length === 0;
  const hasOnlineDevices = deviceRows.some((device) => device.online);

  const personalDevices = visibleDeviceRows.filter((d) => d.scope === 'personal');
  const workspaceDevices = visibleDeviceRows.filter((d) => d.scope === 'workspace');
  // Only split into Personal / Workspace sections once a workspace device exists;
  // otherwise (personal mode / OSS) the list stays flat, exactly as before.
  const showDeviceGroups = workspaceDevices.length > 0;

  // Compute chip
  let chipIcon: ReactNode = <Icon icon={BoxIcon} size={14} />;
  let chipLabel = t('heteroAgent.executionTarget.sandbox');
  if (executionTarget === 'none') {
    chipIcon = <Icon icon={MonitorOffIcon} size={14} />;
    chipLabel = t('heteroAgent.executionTarget.none');
  } else if (executionTarget === 'auto') {
    chipIcon = <Icon icon={SparklesIcon} size={14} />;
    chipLabel = t('heteroAgent.executionTarget.auto');
  } else if (executionTarget === 'local') {
    chipIcon = currentDevice ? (
      getDeviceIcon(currentDevice.platform)
    ) : (
      <Icon icon={LaptopIcon} size={14} />
    );
    chipLabel = t('heteroAgent.executionTarget.local');
  } else if (executionTarget === 'device') {
    chipIcon = getDeviceIcon(boundDevice?.platform);
    chipLabel =
      boundDevice?.friendlyName ??
      boundDevice?.hostname ??
      (isLoading ? t('heteroAgent.executionTarget.loading') : undefined) ??
      t('heteroAgent.executionTarget.unknownDevice');
  }

  const isActive = (target: DeviceExecutionTarget, deviceId?: string) => {
    if (target === 'device') return executionTarget === 'device' && boundDeviceId === deviceId;
    return executionTarget === target;
  };

  const renderDeviceStatus = (d: NonNullable<typeof devices>[number]) => (
    <>
      <span className={d.online ? styles.dotOnline : styles.dotOffline} />
      <span>
        {d.online
          ? t('heteroAgent.executionTarget.online')
          : t('heteroAgent.executionTarget.offline')}
      </span>
    </>
  );

  const renderDeviceRow = (d: NonNullable<typeof devices>[number]) => (
    <OptionRow
      active={isActive('device', d.deviceId)}
      desc={renderDeviceStatus(d)}
      disabled={!d.online}
      icon={getDeviceIcon(d.platform)}
      key={d.deviceId}
      label={d.friendlyName || d.hostname || d.deviceId}
      onClick={() => void handleSelect('device', d.deviceId)}
    />
  );

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
      </div>
      {isHetero ? null : (
        <OptionRow
          active={isActive('none')}
          desc={t('heteroAgent.executionTarget.noneDesc')}
          icon={<Icon icon={MonitorOffIcon} size={14} />}
          label={t('heteroAgent.executionTarget.none')}
          onClick={() => void handleSelect('none')}
        />
      )}
      {isHetero ? null : (
        <OptionRow
          active={isActive('auto')}
          icon={<Icon icon={SparklesIcon} size={14} />}
          label={t('heteroAgent.executionTarget.auto')}
          desc={
            isLoading
              ? t('heteroAgent.executionTarget.loading')
              : hasOnlineDevices
                ? t('heteroAgent.executionTarget.autoDesc')
                : t('heteroAgent.executionTarget.autoUnavailableDesc')
          }
          onClick={() => void handleSelect('auto')}
        />
      )}
      {isDesktop ? (
        <OptionRow
          active={isActive('local')}
          desc={t('heteroAgent.executionTarget.localDesc')}
          tag={t('heteroAgent.executionTarget.local')}
          icon={
            currentDevice ? (
              getDeviceIcon(currentDevice.platform)
            ) : (
              <Icon icon={LaptopIcon} size={14} />
            )
          }
          label={
            currentDevice?.friendlyName ||
            currentDevice?.hostname ||
            t('heteroAgent.executionTarget.local')
          }
          onClick={() => void handleSelect('local')}
        />
      ) : null}
      <OptionRow
        active={isActive('sandbox')}
        desc={t('heteroAgent.executionTarget.sandboxDesc')}
        icon={<Icon icon={BoxIcon} size={14} />}
        label={t('heteroAgent.executionTarget.sandbox')}
        onClick={() => void handleSelect('sandbox')}
      />
      {showDeviceGroups ? (
        <>
          {personalDevices.length > 0 ? (
            <>
              <div className={styles.groupLabel}>
                {t('heteroAgent.executionTarget.personalGroup')}
              </div>
              {personalDevices.map((d) => renderDeviceRow(d))}
            </>
          ) : null}
          <div className={styles.groupLabel}>{t('heteroAgent.executionTarget.workspaceGroup')}</div>
          {workspaceDevices.map((d) => renderDeviceRow(d))}
        </>
      ) : (
        personalDevices.map((d) => renderDeviceRow(d))
      )}
      {hasNoDevices && isLoading ? (
        <div className={styles.empty}>{t('heteroAgent.executionTarget.loading')}</div>
      ) : null}
    </Flexbox>
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
      <div className={styles.button}>
        {chipIcon}
        <span className={styles.buttonLabel}>{chipLabel}</span>
        <Icon icon={ChevronDownIcon} size={12} />
      </div>
    </Popover>
  );
});

HeteroDeviceSwitcher.displayName = 'HeteroDeviceSwitcher';

export default HeteroDeviceSwitcher;
