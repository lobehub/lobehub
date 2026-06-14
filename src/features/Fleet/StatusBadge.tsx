'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { STATUS_COLOR, STATUS_I18N_KEY, type StatusTone } from './status';

interface StatusBadgeProps {
  size?: number;
  tone: StatusTone;
}

const StatusBadge = memo<StatusBadgeProps>(({ tone, size = 8 }) => {
  const { t } = useTranslation('electron');
  const color = STATUS_COLOR[tone];
  const isRunning = tone === 'running';

  return (
    <Flexbox horizontal align={'center'} gap={6} style={{ flex: 'none' }}>
      <span
        style={{
          backgroundColor: color,
          borderRadius: '50%',
          boxShadow: isRunning ? `0 0 0 3px ${cssVar.colorSuccessBg}` : undefined,
          flex: 'none',
          height: size,
          width: size,
        }}
      />
      <Text style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
        {t(STATUS_I18N_KEY[tone] as any)}
      </Text>
    </Flexbox>
  );
});

StatusBadge.displayName = 'FleetStatusBadge';

export default StatusBadge;
