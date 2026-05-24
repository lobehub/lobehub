'use client';

import { isDesktop } from '@lobechat/const';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type { HeteroExecutionTarget } from '@lobechat/types';
import { Flexbox, Icon, Popover } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  LaptopIcon,
  type LucideIcon,
} from 'lucide-react';
import { memo, useCallback, useState } from 'react';
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
    font-size: 11px;
    color: ${cssVar.colorTextDescription};
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
  sectionTitle: css`
    padding-block: 6px 2px;
    padding-inline: 8px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextQuaternary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
}));

interface OptionRowProps {
  active: boolean;
  desc?: string;
  disabled?: boolean;
  icon: LucideIcon;
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
      <div className={styles.optionIcon}>
        <Icon icon={icon} size={14} />
      </div>
      <div className={styles.optionMeta}>
        <div className={styles.optionTitle}>{label}</div>
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

  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const updateAgentConfig = useAgentStore((s) => s.updateAgentConfig);

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
      await updateAgentConfig({
        agencyConfig: {
          ...agencyConfig,
          executionTarget: target,
          ...(target === 'device' && deviceId ? { boundDeviceId: deviceId } : {}),
        },
      });
    },
    [agencyConfig, updateAgentConfig],
  );

  // Don't render for remote hetero agents — they use RemoteAgentConfigCard in profile.
  if (heteroType && isRemoteHeterogeneousType(heteroType)) return null;

  const boundDevice =
    executionTarget === 'device' ? devices?.find((d) => d.deviceId === boundDeviceId) : undefined;

  // Compute chip
  let chipIcon: LucideIcon = CloudIcon;
  let chipLabel = t('heteroAgent.executionTarget.sandbox');
  if (executionTarget === 'local') {
    chipIcon = LaptopIcon;
    chipLabel = t('heteroAgent.executionTarget.local');
  } else if (executionTarget === 'device') {
    chipIcon = BotIcon;
    chipLabel = boundDevice?.hostname ?? t('heteroAgent.executionTarget.unknownDevice');
  }

  const isActive = (target: HeteroExecutionTarget, deviceId?: string) => {
    if (target === 'device') return executionTarget === 'device' && boundDeviceId === deviceId;
    return executionTarget === target;
  };

  const content = (
    <Flexbox gap={2} style={{ maxWidth: 320, minWidth: 280 }}>
      <div className={styles.sectionTitle}>{t('heteroAgent.executionTarget.envSection')}</div>
      {isDesktop ? (
        <OptionRow
          active={isActive('local')}
          desc={t('heteroAgent.executionTarget.localDesc')}
          icon={LaptopIcon}
          label={t('heteroAgent.executionTarget.local')}
          onClick={() => void handleSelect('local')}
        />
      ) : null}
      <OptionRow
        active={isActive('sandbox')}
        desc={t('heteroAgent.executionTarget.sandboxDesc')}
        icon={CloudIcon}
        label={t('heteroAgent.executionTarget.sandbox')}
        onClick={() => void handleSelect('sandbox')}
      />

      <div className={styles.sectionTitle}>{t('heteroAgent.executionTarget.deviceSection')}</div>
      {isLoading ? (
        <div className={styles.empty}>{t('heteroAgent.executionTarget.loading')}</div>
      ) : (devices?.length ?? 0) === 0 ? (
        <div className={styles.empty}>{t('heteroAgent.executionTarget.noDevices')}</div>
      ) : (
        (devices ?? []).map((d) => (
          <OptionRow
            active={isActive('device', d.deviceId)}
            disabled={!d.online}
            icon={BotIcon}
            key={d.deviceId}
            label={d.hostname}
            desc={
              d.online
                ? t('heteroAgent.executionTarget.online')
                : t('heteroAgent.executionTarget.offline')
            }
            onClick={() => void handleSelect('device', d.deviceId)}
          />
        ))
      )}
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
        <Icon icon={chipIcon} size={14} />
        <span>{chipLabel}</span>
        <Icon icon={ChevronDownIcon} size={12} />
      </div>
    </Popover>
  );
});

HeteroDeviceSwitcher.displayName = 'HeteroDeviceSwitcher';

export default HeteroDeviceSwitcher;
