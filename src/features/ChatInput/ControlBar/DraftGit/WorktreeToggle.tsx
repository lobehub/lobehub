'use client';

import { Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SplitIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorktreeMode } from './useWorktreeMode';

const styles = stylex.create({
  // Lucide's Split stands upright (trunk below, branching up); turned a quarter
  // clockwise the trunk comes in from the left and forks to the right.
  icon: { transform: 'rotate(90deg)' },
  off: {
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
  },
  // Info blue, like the composer's other "on" switches (Memory, the SDK runtime
  // chip): the neutral primary barely differs from the off state at this size.
  on: {
    color: cssVar.colorInfo,
    backgroundColor: { 'default': cssVar.colorInfoBg, ':hover': cssVar.colorInfoBgHover },
  },
  pending: { cursor: 'progress', opacity: 0.5 },
  toggle: {
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    borderRadius: '4px',
    transition: 'background 0.2s, color 0.2s',
    backgroundImage: 'none',
  },
  tooltip: { display: 'flex', flexDirection: 'column', gap: '2px' },
  tooltipHint: { fontSize: '12px', opacity: 0.75 },
});

interface WorktreeToggleProps {
  /** The branch the new worktree would be cut from, named in the tooltip. */
  baseBranch?: string;
  keyDeviceId?: string;
  path: string;
}

/**
 * The new-topic composer's "New worktree" switch. On, the first send cuts a
 * new `lobehub/…` branch from the picked branch into its own worktree and runs
 * the topic there, leaving this directory untouched. Remembered per directory.
 *
 * The icon is a sideways Split: one line in from the left, forking into two
 * paths to the right — "branch off a separate line of work from here". Not
 * `GitFork`: the worktree switcher and `StaleGitSnapshot` already use it to say
 * "you are inside a linked worktree", a state rather than this action.
 */
export const WorktreeToggle = ({ baseBranch, keyDeviceId, path }: WorktreeToggleProps) => {
  const { t } = useTranslation('device');
  const { enabled, ready, setEnabled } = useWorktreeMode(keyDeviceId, path);
  const label = t('workingDirectory.worktreeToggle');

  return (
    <Tooltip
      title={
        <div {...stylex.props(styles.tooltip)}>
          <span>{enabled ? t('workingDirectory.worktreeToggleOn') : label}</span>
          <span {...stylex.props(styles.tooltipHint)}>
            {enabled
              ? t('workingDirectory.worktreeToggleOnHint', { branch: baseBranch ?? '' })
              : t('workingDirectory.worktreeToggleOffHint')}
          </span>
        </div>
      }
    >
      <div
        aria-busy={!ready}
        aria-label={label}
        aria-pressed={enabled}
        role="button"
        tabIndex={0}
        {...stylex.props(styles.toggle, enabled ? styles.on : styles.off, !ready && styles.pending)}
        onClick={ready ? () => void setEnabled(!enabled) : undefined}
        onKeyDown={(event) => {
          if (!ready || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          void setEnabled(!enabled);
        }}
      >
        <Icon icon={SplitIcon} size={14} {...stylex.props(styles.icon)} />
      </div>
    </Tooltip>
  );
};
