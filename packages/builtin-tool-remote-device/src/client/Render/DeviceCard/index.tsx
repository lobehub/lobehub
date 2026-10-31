'use client';

import { cx, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckCircle2, MonitorIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceAttachment } from '../../../ExecutionRuntime/types';

const styles = stylex.create({
  activated: { color: cssVar.colorSuccess, background: cssVar.colorSuccessBg },
  badge: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: '12px',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
  },
  card: {
    paddingBlock: '12px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    background: cssVar.colorBgContainer,
  },
  details: {
    overflow: 'hidden',
    maxWidth: '50%',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextDescription,
    textAlign: 'end',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  hostname: {
    overflow: 'hidden',
    fontSize: cssVar.fontSize,
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  icon: {
    flex: 'none',
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillTertiary,
  },
  listItem: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: { 'default': null, ':not(:last-child)': '1px' },
    borderBlockEndStyle: { 'default': null, ':not(:last-child)': 'solid' },
    borderBlockEndColor: { 'default': null, ':not(:last-child)': cssVar.colorBorderSecondary },
  },
  root: { width: '100%' },
  status: {
    display: 'inline-flex',
    flex: 'none',
    gap: '6px',
    alignItems: 'center',
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextSecondary,
  },
  statusDot: {
    width: '7px',
    height: '7px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorTextQuaternary,
    borderRadius: '50%',
  },
  statusDotOnline: {
    borderStyle: 'none',
    background: cssVar.colorSuccess,
    boxShadow: `0 0 0 3px ${cssVar.colorSuccessBg}`,
  },
});

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
      gap={12}
      role={variant === 'listItem' ? 'listitem' : undefined}
      className={cx(
        stylex.props(styles.root, variant === 'card' ? styles.card : styles.listItem).className,
      )}
    >
      <Flexbox align={'center'} className={stylex.props(styles.icon).className} justify={'center'}>
        <Icon icon={MonitorIcon} size={18} />
      </Flexbox>
      <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
        <span {...stylex.props(styles.hostname)}>{displayName}</span>
        {!activated && (
          <span {...stylex.props(styles.status)}>
            <span
              className={[
                stylex.props(styles.statusDot).className,
                stylex.props(device.online ? styles.statusDotOnline : undefined).className,
              ]
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
        <span
          className={[
            stylex.props(styles.badge).className,
            stylex.props(styles.activated).className,
          ].join(' ')}
        >
          <Icon icon={CheckCircle2} size={12} />
          {t('builtins.lobe-remote-device.render.activated')}
        </span>
      ) : (
        details && <span {...stylex.props(styles.details)}>{details}</span>
      )}
    </Flexbox>
  );
});

DeviceCard.displayName = 'DeviceCard';

export default DeviceCard;
