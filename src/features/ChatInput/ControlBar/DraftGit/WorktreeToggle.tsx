'use client';

import { Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FolderGit2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorktreeMode } from './useWorktreeMode';

const styles = stylex.create({
  off: {
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
  },
  on: {
    color: cssVar.colorPrimary,
    backgroundColor: { 'default': cssVar.colorPrimaryBg, ':hover': cssVar.colorPrimaryBgHover },
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
 * The new-topic composer's "New worktree" switch. A git-folder icon, not a
 * fork: the fork reads as a branch, and this creates a working directory. On, the first send cuts a
 * new `lobehub/…` branch from the picked branch into its own worktree and runs
 * the topic there, leaving this directory untouched. Remembered per directory.
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
        <Icon icon={FolderGit2Icon} size={13} />
      </div>
    </Tooltip>
  );
};
