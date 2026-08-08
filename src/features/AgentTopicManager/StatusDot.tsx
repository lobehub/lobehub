'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar, useTheme } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TOPIC_STATUS_VISUALS } from '@/components/ExecutionStatus';
import RingLoadingIcon from '@/components/RingLoading';

// Dot colors come from the shared execution-status visuals so the management
// table reads the same as the sidebar topic lists; `idle` is a synthetic
// fallback for topics that dropped out of the running set.
const STATUS_COLOR: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(TOPIC_STATUS_VISUALS).map(([status, visual]) => [status, visual.color]),
  ),
  idle: cssVar.colorTextQuaternary,
};

interface StatusDotProps {
  status: string | undefined;
}

const StatusDot = memo<StatusDotProps>(({ status: rawStatus }) => {
  const { t } = useTranslation('topic');
  const { isDarkMode } = useTheme();
  // No status (e.g. a topic that dropped out of the running set) reads as idle.
  const status = rawStatus || 'idle';
  const color = STATUS_COLOR[status] ?? cssVar.colorTextQuaternary;
  const labelKey = `management.status.${status}` as const;

  // Match the sidebar Topic row: running shows the same spinning ring icon
  // (warning color) rather than a static dot, so users get a consistent
  // visual signal for "this topic is currently running".
  const isRunning = status === 'running';
  const ringColor = isDarkMode
    ? cssVar.colorWarningBorder
    : `color-mix(in srgb, ${cssVar.colorWarning} 45%, transparent)`;

  return (
    <Flexbox horizontal align={'center'} gap={6}>
      {isRunning ? (
        <RingLoadingIcon ringColor={ringColor} size={10} style={{ color: cssVar.colorWarning }} />
      ) : (
        <span
          style={{
            background: color,
            borderRadius: '50%',
            flexShrink: 0,
            height: 6,
            width: 6,
          }}
        />
      )}
      <span style={{ color: cssVar.colorTextSecondary, fontSize: 11 }}>{t(labelKey as any)}</span>
    </Flexbox>
  );
});

StatusDot.displayName = 'AgentTopicManagerStatusDot';

export default StatusDot;
