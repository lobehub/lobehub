'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
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
    padding-block: 12px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,
  details: css`
    overflow: hidden;

    max-width: 50%;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextDescription};
    text-align: end;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  listItem: css`
    padding-block: 10px;
    padding-inline: 12px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  root: css`
    width: 100%;
  `,
  status: css`
    display: inline-flex;
    flex: none;
    gap: 6px;
    align-items: center;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  statusDot: css`
    width: 7px;
    height: 7px;
    border: 1px solid ${cssVar.colorTextQuaternary};
    border-radius: 50%;
  `,
  statusDotOnline: css`
    border: none;
    background: ${cssVar.colorSuccess};
    box-shadow: 0 0 0 3px ${cssVar.colorSuccessBg};
  `,
}));

interface DeviceCardProps {
  /** Render the activated treatment (check badge) instead of the online badge. */
  activated?: boolean;
  device: DeviceAttachment;
  variant?: 'card' | 'listItem';
}

const DeviceCard = memo<DeviceCardProps>(({ device, activated, variant = 'card' }) => {
  const { t } = useTranslation('plugin');
  const displayName = device.friendlyName || device.hostname;
  const scopeLabel = device.scope
    ? t(`builtins.lobe-remote-device.render.scope.${device.scope}`)
    : undefined;
  const details = [device.friendlyName ? device.hostname : undefined, device.platform, scopeLabel]
    .filter(Boolean)
    .join(' · ');

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.root, variant === 'card' ? styles.card : styles.listItem)}
      gap={12}
      role={variant === 'listItem' ? 'listitem' : undefined}
    >
      <Flexbox align={'center'} className={styles.icon} justify={'center'}>
        <Icon icon={MonitorIcon} size={18} />
      </Flexbox>
      <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
        <span className={styles.hostname}>{displayName}</span>
        {!activated && (
          <span className={styles.status}>
            <span
              className={[styles.statusDot, device.online ? styles.statusDotOnline : undefined]
                .filter(Boolean)
                .join(' ')}
            />
            {t(
              device.online
                ? 'builtins.lobe-remote-device.render.online'
                : 'builtins.lobe-remote-device.render.offline',
            )}
          </span>
        )}
      </Flexbox>
      {activated ? (
        <span className={[styles.badge, styles.activated].join(' ')}>
          <Icon icon={CheckCircle2} size={12} />
          {t('builtins.lobe-remote-device.render.activated')}
        </span>
      ) : (
        details && <span className={styles.details}>{details}</span>
      )}
    </Flexbox>
  );
});

DeviceCard.displayName = 'DeviceCard';

export default DeviceCard;
