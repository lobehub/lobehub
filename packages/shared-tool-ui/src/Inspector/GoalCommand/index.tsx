'use client';

import type { RunCommandState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Target, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '../../styles';
import { type GoalCommand, isGoalCommandFailed } from '../../utils/goalCommand';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    flexShrink: 1,
    minWidth: '0',
    marginInlineStart: '6px',
    paddingBlock: '2px',
    paddingInline: '10px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    background: cssVar.colorFillTertiary,
  },
  icon: { flexShrink: 0, marginInlineEnd: '6px', color: cssVar.colorTextDescription },
  statusIcon: { flexShrink: 0, marginInlineStart: '4px' },
});

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
        <Target className={stylex.props(styles.icon).className} size={14} />
        <span className={cx(inFlight && shinyTextStyles.shinyText)}>
          {t(`builtins.goalCommand.${goalCommand.kind}.${status}` as any)}
        </span>
        {title && <span {...stylex.props(styles.chip)}>{title}</span>}
        {failed && (
          <X
            className={stylex.props(styles.statusIcon).className}
            color={cssVar.colorError}
            size={14}
          />
        )}
      </div>
    );
  },
);

GoalCommandInspector.displayName = 'GoalCommandInspector';
