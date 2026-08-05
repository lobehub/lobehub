'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
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

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    gap: 6px;
    align-items: center;

    min-width: 0;
    max-width: min(420px, 60vw);
    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 999px;

    background: ${cssVar.colorFillTertiary};
  `,
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextDescription};
  `,
  leadingIcon: css`
    margin-inline-end: 6px;
  `,
  risk: css`
    flex-shrink: 0;

    margin-inline-start: 6px;
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorError};

    background: ${cssVar.colorErrorBg};
  `,
  target: css`
    overflow: hidden;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

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
  <span className={styles.chip} title={target}>
    <GitForkIcon className={styles.icon} size={12} />
    <span className={styles.target}>{target}</span>
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
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{label}</span>
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
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <GitForkIcon className={cx(styles.icon, styles.leadingIcon)} size={12} />
        <span>{label}</span>
        {action === 'remove' && discardChanges && (
          <span className={styles.risk}>
            {t('builtins.lobe-claude-code.worktree.discardChanges')}
          </span>
        )}
      </div>
    );
  },
);

ExitWorktreeInspector.displayName = 'ClaudeCodeExitWorktreeInspector';
