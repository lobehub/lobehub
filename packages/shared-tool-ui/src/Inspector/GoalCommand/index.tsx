'use client';

import type { RunCommandState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from '@lobehub/ui';
import { Target, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '../../styles';
import { type GoalCommand, isGoalCommandFailed } from '../../utils/goalCommand';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    flex-shrink: 1;

    min-width: 0;
    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  icon: css`
    flex-shrink: 0;
    margin-inline-end: 6px;
    color: ${cssVar.colorTextDescription};
  `,
  statusIcon: css`
    flex-shrink: 0;
    margin-inline-start: 4px;
  `,
}));

export interface GoalCommandInspectorProps extends BuiltinInspectorProps<
  { command?: string },
  RunCommandState
> {
  goalCommand: GoalCommand;
}

/**
 * A CLI agent's `lh goal create` / `lh goal plan` step, read as the goal step it
 * is rather than a raw shell command: while it runs the user sees the goal being
 * created, then planned, and the settled row keeps the goal's title.
 */
export const GoalCommandInspector = memo<GoalCommandInspectorProps>(
  ({ goalCommand, isArgumentsStreaming, isLoading, pluginState, result }) => {
    const { t } = useTranslation('plugin');

    const inFlight = !!(isArgumentsStreaming || isLoading);
    const failed = !inFlight && isGoalCommandFailed({ error: result?.error, state: pluginState });
    const status = inFlight ? 'loading' : failed ? 'failed' : 'completed';
    const title = goalCommand.kind === 'create' ? goalCommand.title : undefined;

    return (
      <div className={inspectorTextStyles.root}>
        <Target className={styles.icon} size={14} />
        <span className={cx(inFlight && shinyTextStyles.shinyText)}>
          {t(`builtins.goalCommand.${goalCommand.kind}.${status}` as any)}
        </span>
        {title && <span className={styles.chip}>{title}</span>}
        {failed && <X className={styles.statusIcon} color={cssVar.colorError} size={14} />}
      </div>
    );
  },
);

GoalCommandInspector.displayName = 'GoalCommandInspector';
