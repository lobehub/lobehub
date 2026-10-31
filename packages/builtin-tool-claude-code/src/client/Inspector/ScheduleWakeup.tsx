'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type ScheduleWakeupArgs } from '../../types';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: '0',
    marginInlineStart: '6px',
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    background: cssVar.colorFillTertiary,
  },
  delay: { flexShrink: 0, marginInlineStart: '8px', color: cssVar.colorTextDescription },
});

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
      <div className={inspectorTextStyles.root}>
        <span className={cx(isShiny && shinyTextStyles.shinyText)}>
          {reason || typeof delay === 'number' ? `${label}:` : label}
        </span>
        {reason && <span {...stylex.props(styles.chip)}>{reason}</span>}
        {typeof delay === 'number' && (
          <span {...stylex.props(styles.delay)}>· {formatDelay(delay)}</span>
        )}
      </div>
    );
  },
);

ScheduleWakeupInspector.displayName = 'ClaudeCodeScheduleWakeupInspector';
