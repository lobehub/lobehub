'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { GitForkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { EnterWorktreeArgs, ExitWorktreeArgs } from '../../types';

type InspectorPhase = 'completed' | 'failed' | 'idle' | 'loading';

const CREATE_LABEL_KEYS = {
  completed: 'builtins.lobe-claude-code.worktree.create.completed',
  failed: 'builtins.lobe-claude-code.worktree.create.failed',
  idle: 'builtins.lobe-claude-code.worktree.create.idle',
  loading: 'builtins.lobe-claude-code.worktree.create.loading',
} as const;

const ENTER_LABEL_KEYS = {
  completed: 'builtins.lobe-claude-code.worktree.enter.completed',
  failed: 'builtins.lobe-claude-code.worktree.enter.failed',
  idle: 'builtins.lobe-claude-code.worktree.enter.idle',
  loading: 'builtins.lobe-claude-code.worktree.enter.loading',
} as const;

const EXIT_LABEL_KEYS = {
  completed: 'builtins.lobe-claude-code.worktree.exit.completed',
  failed: 'builtins.lobe-claude-code.worktree.exit.failed',
  idle: 'builtins.lobe-claude-code.worktree.exit.idle',
  loading: 'builtins.lobe-claude-code.worktree.exit.loading',
} as const;

const REMOVE_LABEL_KEYS = {
  completed: 'builtins.lobe-claude-code.worktree.remove.completed',
  failed: 'builtins.lobe-claude-code.worktree.remove.failed',
  idle: 'builtins.lobe-claude-code.worktree.remove.idle',
  loading: 'builtins.lobe-claude-code.worktree.remove.loading',
} as const;

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
    maxWidth: 'min(420px, 60vw)',
    marginInlineStart: '6px',
    paddingBlock: '2px',
    paddingInline: '10px',
    borderRadius: '999px',
    background: cssVar.colorFillTertiary,
  },
  icon: { flexShrink: 0, color: cssVar.colorTextDescription },
  leadingIcon: { marginInlineEnd: '6px' },
  risk: {
    flexShrink: 0,
    marginInlineStart: '6px',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorError,
    background: cssVar.colorErrorBg,
  },
  target: {
    overflow: 'hidden',
    minWidth: '0',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const resolvePhase = (
  isArgumentsStreaming: boolean | undefined,
  isLoading: boolean | undefined,
  hasError: boolean,
  hasResult: boolean,
): InspectorPhase => {
  if (isArgumentsStreaming || isLoading) return 'loading';
  if (hasError) return 'failed';
  if (hasResult) return 'completed';
  return 'idle';
};

interface WorktreeTargetProps {
  target: string;
}

const WorktreeTarget = memo<WorktreeTargetProps>(({ target }) => (
  <span {...stylex.props(styles.chip)} title={target}>
    <GitForkIcon className={stylex.props(styles.icon).className} size={12} />
    <span {...stylex.props(styles.target)}>{target}</span>
  </span>
));

WorktreeTarget.displayName = 'ClaudeCodeWorktreeTarget';

export const EnterWorktreeInspector = memo<BuiltinInspectorProps<EnterWorktreeArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, result }) => {
    const { t } = useTranslation('plugin');
    const name = args?.name?.trim() || partialArgs?.name?.trim();
    const path = args?.path?.trim() || partialArgs?.path?.trim();
    const target = name || path;
    const phase = resolvePhase(
      isArgumentsStreaming,
      isLoading,
      Boolean(result?.error),
      Boolean(result),
    );
    const label = t((path ? ENTER_LABEL_KEYS : CREATE_LABEL_KEYS)[phase]);

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {label}
        </span>
        {target && <WorktreeTarget target={target} />}
      </div>
    );
  },
);

EnterWorktreeInspector.displayName = 'ClaudeCodeEnterWorktreeInspector';

export const ExitWorktreeInspector = memo<BuiltinInspectorProps<ExitWorktreeArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, result }) => {
    const { t } = useTranslation('plugin');
    const action = args?.action || partialArgs?.action;
    const discardChanges = args?.discard_changes ?? partialArgs?.discard_changes;
    const phase = resolvePhase(
      isArgumentsStreaming,
      isLoading,
      Boolean(result?.error),
      Boolean(result),
    );
    const label = t((action === 'remove' ? REMOVE_LABEL_KEYS : EXIT_LABEL_KEYS)[phase]);

    return (
      <div className={inspectorTextStyles.root}>
        <GitForkIcon
          className={cx(stylex.props(styles.icon, styles.leadingIcon).className)}
          size={12}
        />
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {label}
        </span>
        {action === 'remove' && discardChanges && (
          <span {...stylex.props(styles.risk)}>
            {t('builtins.lobe-claude-code.worktree.discardChanges')}
          </span>
        )}
      </div>
    );
  },
);

ExitWorktreeInspector.displayName = 'ClaudeCodeExitWorktreeInspector';
