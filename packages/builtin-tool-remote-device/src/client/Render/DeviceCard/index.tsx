'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { CheckCircle2, MonitorIcon } from 'lucide-react';
import { memo } from 'react';

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
    border-radius: 6px;

    font-size: 12px;
    line-height: 16px;
    white-space: nowrap;
  `,
  card: css`
    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;

    background: ${cssVar.colorBgContainer};
  `,
  hostname: css`
    overflow: hidden;

    font-size: 14px;
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
    font-size: 12px;
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

const DeviceCard = memo<DeviceCardProps>(({ device, activated }) => (
  <Flexbox horizontal align={'center'} className={styles.card} gap={12}>
    <Flexbox align={'center'} className={styles.icon} justify={'center'}>
      <Icon icon={MonitorIcon} size={18} />
    </Flexbox>
    <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
      <span className={styles.hostname}>{device.hostname}</span>
      <span className={styles.meta}>
        {device.platform} · {device.deviceId.slice(0, 12)}
      </span>
    </Flexbox>
    {activated ? (
      <span className={[styles.badge, styles.activated].join(' ')}>
        <Icon icon={CheckCircle2} size={12} />
        Activated
      </span>
    ) : (
      device.online && <span className={[styles.badge, styles.online].join(' ')}>Online</span>
    )}
  </Flexbox>
));

DeviceCard.displayName = 'DeviceCard';

export default DeviceCard;
