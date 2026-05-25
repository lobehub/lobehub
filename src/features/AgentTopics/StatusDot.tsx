'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const STATUS_COLOR: Record<string, string> = {
  active: cssVar.colorSuccess,
  archived: cssVar.colorWarning,
  completed: cssVar.colorTextQuaternary,
  failed: cssVar.colorError,
  paused: cssVar.colorInfo,
  running: cssVar.colorInfo,
  waitingForHuman: cssVar.colorInfo,
};

interface StatusDotProps {
  status: string;
}

const StatusDot = memo<StatusDotProps>(({ status }) => {
  const { t } = useTranslation('topic');
  const color = STATUS_COLOR[status] ?? cssVar.colorTextQuaternary;
  const labelKey = `management.status.${status}` as const;

  return (
    <Flexbox horizontal align={'center'} gap={6}>
      <span
        style={{
          background: color,
          borderRadius: '50%',
          flexShrink: 0,
          height: 6,
          width: 6,
        }}
      />
      <span style={{ color: cssVar.colorTextSecondary, fontSize: 11 }}>{t(labelKey as any)}</span>
    </Flexbox>
  );
});

StatusDot.displayName = 'AgentTopicsStatusDot';

export default StatusDot;
