'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { CheckCircle2, MonitorIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceAttachment } from '../../../ExecutionRuntime/types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  activated: css`
    color: ${cssVar.colorSuccess};
    background: ${cssVar.colorSuccessBg};
  `,
  badge: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;
    line-height: 16px;
    white-space: nowrap;
  `,
  card: css`
    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,
  hostname: css`
    overflow: hidden;

    font-size: ${cssVar.fontSize};
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  icon: css`
    flex: none;

    width: 32px;
    height: 32px;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  meta: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  online: css`
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorFillTertiary};
  `,
}));

interface DeviceCardProps {
  /** Render the activated treatment (check badge) instead of the online badge. */
  activated?: boolean;
  device: DeviceAttachment;
}

const DeviceCard = memo<DeviceCardProps>(({ device, activated }) => {
  const { t } = useTranslation('plugin');
  const displayName = device.friendlyName || device.hostname;
  const scopeLabel = device.scope
    ? t(`builtins.lobe-remote-device.render.scope.${device.scope}`)
    : undefined;

  return (
    <Flexbox horizontal align={'center'} className={styles.card} gap={12}>
      <Flexbox align={'center'} className={styles.icon} justify={'center'}>
        <Icon icon={MonitorIcon} size={18} />
      </Flexbox>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <span className={styles.hostname}>{displayName}</span>
        <span className={styles.meta}>
          {[device.friendlyName ? device.hostname : undefined, device.platform, scopeLabel]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </Flexbox>
      {activated ? (
        <span className={[styles.badge, styles.activated].join(' ')}>
          <Icon icon={CheckCircle2} size={12} />
          {t('builtins.lobe-remote-device.render.activated')}
        </span>
      ) : (
        device.online && (
          <span className={[styles.badge, styles.online].join(' ')}>
            {t('builtins.lobe-remote-device.render.online')}
          </span>
        )
      )}
    </Flexbox>
  );
});

DeviceCard.displayName = 'DeviceCard';

export default DeviceCard;
