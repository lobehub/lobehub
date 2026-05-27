'use client';

import { SiApple, SiLinux } from '@icons-pack/react-simple-icons';
import { isDesktop } from '@lobechat/const';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type { HeteroExecutionTarget, RuntimeEnvMode } from '@lobechat/types';
import { Microsoft } from '@lobehub/icons';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  InfoIcon,
  LaptopIcon,
  MonitorIcon,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    height: 28px;
    padding-inline: 8px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
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
}));

interface OptionRowProps {
  active: boolean;
  desc?: ReactNode;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

const OptionRow = memo<OptionRowProps>(({ active, desc, disabled, icon, label, onClick }) => {
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
        <div className={styles.optionTitle}>{label}</div>
        {desc ? <div className={styles.desc}>{desc}</div> : null}
      </div>
      {active ? <Icon className={styles.check} icon={CheckIcon} size={14} /> : null}
    </div>
  );
});

OptionRow.displayName = 'HeteroDeviceSwitcher.OptionRow';

const getDeviceIcon = (platform: string | undefined, size = 14): ReactNode => {
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

  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  const heteroType = agencyConfig?.heterogeneousProvider?.type;
  const storedTarget = agencyConfig?.executionTarget;
  const boundDeviceId = agencyConfig?.boundDeviceId;

  // Effective target: falls back to local on desktop, sandbox on web
  const executionTarget: HeteroExecutionTarget = storedTarget ?? (isDesktop ? 'local' : 'sandbox');

  const { data: devices, isLoading } = lambdaQuery.device.listDevices.useQuery(undefined, {
    staleTime: 30_000,
  });

  const handleSelect = useCallback(
    async (target: HeteroExecutionTarget, deviceId?: string) => {
      setOpen(false);

      // Keep runtimeMode in sync so the server-side tool gate (runtimeMode === 'cloud'
      // enables CloudSandbox) reflects the user's chosen execution target.
      // Use a single updateAgentConfigById to persist both fields atomically — parallel
      // calls share the same abort signal name and the second would cancel the first.
      const platform = isDesktop ? 'desktop' : 'web';
      const runtimeMode: RuntimeEnvMode =
        target === 'sandbox' ? 'cloud' : target === 'local' ? 'local' : 'none';

      await updateAgentConfigById(agentId, {
        agencyConfig: {
          ...agencyConfig,
          executionTarget: target,
          ...(target === 'device' && deviceId ? { boundDeviceId: deviceId } : {}),
        },
        chatConfig: { runtimeEnv: { runtimeMode: { [platform]: runtimeMode } } },
      });
    },
    [agentId, agencyConfig, updateAgentConfigById],
  );

  // Don't render for remote hetero agents — they use RemoteAgentConfigCard in profile.
  if (heteroType && isRemoteHeterogeneousType(heteroType)) return null;

  const boundDevice =
    executionTarget === 'device' ? devices?.find((d) => d.deviceId === boundDeviceId) : undefined;
  const hasNoDevices = !devices || devices.length === 0;

  // Compute chip
  let chipIcon: ReactNode = <Icon icon={CloudIcon} size={14} />;
  let chipLabel = t('heteroAgent.executionTarget.sandbox');
  if (executionTarget === 'local') {
    chipIcon = <Icon icon={LaptopIcon} size={14} />;
    chipLabel = t('heteroAgent.executionTarget.local');
  } else if (executionTarget === 'device') {
    chipIcon = getDeviceIcon(boundDevice?.platform);
    chipLabel = boundDevice?.hostname ?? t('heteroAgent.executionTarget.unknownDevice');
  }

  const isActive = (target: HeteroExecutionTarget, deviceId?: string) => {
    if (target === 'device') return executionTarget === 'device' && boundDeviceId === deviceId;
    return executionTarget === target;
  };

  const content = (
    <Flexbox gap={2} style={{ maxWidth: 320, minWidth: 280 }}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{t('heteroAgent.executionTarget.title')}</span>
        <Tooltip title={t('heteroAgent.executionTarget.infoTooltip')}>
          <span className={styles.headerInfo}>
            <Icon icon={InfoIcon} size={12} />
          </span>
        </Tooltip>
      </div>
      {isDesktop ? (
        <OptionRow
          active={isActive('local')}
          desc={t('heteroAgent.executionTarget.localDesc')}
          icon={<Icon icon={LaptopIcon} size={14} />}
          label={t('heteroAgent.executionTarget.local')}
          onClick={() => void handleSelect('local')}
        />
      ) : null}
      <OptionRow
        active={isActive('sandbox')}
        desc={t('heteroAgent.executionTarget.sandboxDesc')}
        icon={<Icon icon={CloudIcon} size={14} />}
        label={t('heteroAgent.executionTarget.sandbox')}
        onClick={() => void handleSelect('sandbox')}
      />
      {(devices ?? []).map((d) => (
        <OptionRow
          active={isActive('device', d.deviceId)}
          disabled={!d.online}
          icon={getDeviceIcon(d.platform)}
          key={d.deviceId}
          label={d.hostname}
          desc={
            <>
              <span className={d.online ? styles.dotOnline : styles.dotOffline} />
              <span>
                {d.online
                  ? t('heteroAgent.executionTarget.online')
                  : t('heteroAgent.executionTarget.offline')}
              </span>
            </>
          }
          onClick={() => void handleSelect('device', d.deviceId)}
        />
      ))}
      {hasNoDevices && isLoading ? (
        <div className={styles.empty}>{t('heteroAgent.executionTarget.loading')}</div>
      ) : null}
      {hasNoDevices && !isLoading ? (
        <div className={styles.empty}>{t('heteroAgent.executionTarget.noDevices')}</div>
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
        <span>{chipLabel}</span>
        <Icon icon={ChevronDownIcon} size={12} />
      </div>
    </Popover>
  );
});

HeteroDeviceSwitcher.displayName = 'HeteroDeviceSwitcher';

export default HeteroDeviceSwitcher;
