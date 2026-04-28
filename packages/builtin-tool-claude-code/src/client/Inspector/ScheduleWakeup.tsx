'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type ScheduleWakeupArgs } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    max-width: 60%;
    margin-inline-start: 6px;
    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  delay: css`
    flex-shrink: 0;
    margin-inline-start: 8px;
    color: ${cssVar.colorTextDescription};
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
 * CC's self-paced wakeup scheduler. `reason` (the model's one-sentence
 * justification) goes in the chip as the primary signal; `delaySeconds`
 * trails at the end as secondary context.
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
        <span>{reason || typeof delay === 'number' ? `${label}:` : label}</span>
        {reason && <span className={styles.chip}>{reason}</span>}
        {typeof delay === 'number' && <span className={styles.delay}>· {formatDelay(delay)}</span>}
      </div>
    );
  },
);

ScheduleWakeupInspector.displayName = 'ClaudeCodeScheduleWakeupInspector';
