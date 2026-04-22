'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { AlarmClock } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type ScheduleWakeupArgs } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;

    margin-inline-start: 6px;
    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};
  `,
  icon: css`
    flex-shrink: 0;
    margin-inline-end: 6px;
    color: ${cssVar.colorTextDescription};
  `,
  reason: css`
    overflow: hidden;

    min-width: 0;
    margin-inline-start: 8px;

    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const formatDelay = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return `${seconds}s`;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60) {
    return remSeconds > 0 ? `${minutes}m ${remSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
};

/**
 * CC's self-paced wakeup scheduler. Primary signal is `delaySeconds` (what
 * gets shown in the chip as a readable duration); `reason` is the model's
 * own one-sentence justification and trails after as secondary context.
 */
export const ScheduleWakeupInspector = memo<BuiltinInspectorProps<ScheduleWakeupArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t(ClaudeCodeApiName.ScheduleWakeup as any);

    const source = args ?? partialArgs;
    const delay = source?.delaySeconds;
    const reason = source?.reason?.trim();

    const isShiny = isArgumentsStreaming || isLoading;

    if (isArgumentsStreaming && delay === undefined && !reason) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    return (
      <div className={cx(inspectorTextStyles.root, isShiny && shinyTextStyles.shinyText)}>
        <AlarmClock className={styles.icon} size={14} />
        <span>{label}</span>
        {typeof delay === 'number' && <span className={styles.chip}>{formatDelay(delay)}</span>}
        {reason && <span className={styles.reason}>· {reason}</span>}
      </div>
    );
  },
);

ScheduleWakeupInspector.displayName = 'ClaudeCodeScheduleWakeupInspector';
