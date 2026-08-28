import type { WorkingDirGitState } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import {
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { GitBranchIcon, GitForkIcon, GitPullRequest, RotateCcwIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';

import { gitChipStyles } from './gitChipStyles';
import { resolveStaleSnapshot } from './staleSnapshot';
import { useSwitchWorktree } from './useSwitchWorktree';

const styles = createStaticStyles(({ css }) => ({
  action: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  explanation: css`
    max-width: 320px;
    padding-block: 6px 8px;
    padding-inline: 10px;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  path: css`
    display: block;

    margin-block-start: 2px;

    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextTertiary};
    word-break: break-all;
  `,
  popup: css`
    padding: 0;
  `,
  triggerLabel: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface StaleGitSnapshotProps {
  agentId: string;
  /** The topic's persisted git context — the only source here; nothing is probed. */
  git: WorkingDirGitState;
  isGithub: boolean;
  /** The recorded effective directory, i.e. the one that no longer exists. */
  path: string;
  /** The source repo the worktree was linked from, when the topic recorded one. */
  sourcePath?: string;
}

/**
 * What the control bar shows when the directory the topic recorded is gone.
 *
 * Every live control (checkout, worktree switch, pull/push, diff review) needs a
 * directory that no longer exists, so none of them render. What remains is the
 * topic's own snapshot — the same one the sidebar meta hover card reads — plus
 * the two things that still work without a local directory: opening the linked
 * PR, and dropping the dead worktree override so the conversation falls back to
 * its source repo. Without that second one the state is a dead end: the bar
 * explains why the branch is frozen but leaves no way out of it.
 */
const StaleGitSnapshot = memo<StaleGitSnapshotProps>(
  ({ agentId, git, isGithub, path, sourcePath }) => {
    const { t } = useTranslation('device');
    const [open, setOpen] = useState(false);
    const [resetting, setResetting] = useState(false);
    const switchWorktree = useSwitchWorktree({ agentId, isGithub, sourcePath: sourcePath ?? path });

    const { branch, explanation, isWorktree, pullRequest, reset, worktreePath } =
      resolveStaleSnapshot({ git, path, sourcePath });

    const handleOpenPr = useCallback(() => {
      if (pullRequest?.url) {
        void electronSystemService.openExternalLink(pullRequest.url);
      }
    }, [pullRequest?.url]);

    const resetTarget = reset?.targetPath;
    const handleReset = useCallback(async () => {
      if (resetting || !resetTarget) return;
      setResetting(true);
      try {
        // Committing the SOURCE path is what clears `git.activeWorktree` — same
        // funnel the worktree dropdown uses, so the two can't drift apart.
        await switchWorktree(resetTarget);
        setOpen(false);
      } finally {
        setResetting(false);
      }
    }, [resetting, resetTarget, switchWorktree]);

    const trigger = (
      <div className={gitChipStyles.staleTrigger}>
        <Icon icon={isWorktree ? GitForkIcon : GitBranchIcon} size={12} />
        <span className={styles.triggerLabel}>{branch}</span>
      </div>
    );

    return (
      <>
        <div className={gitChipStyles.separator} />
        <DropdownMenuRoot open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger>
            <div>{trigger}</div>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuPositioner placement="topLeft" sideOffset={8}>
              <DropdownMenuPopup className={styles.popup}>
                <div className={styles.explanation}>
                  {t(explanation.key, explanation.values)}
                  <span className={styles.path}>{worktreePath}</span>
                </div>
                {reset && (
                  <DropdownMenuItem
                    aria-disabled={resetting}
                    closeOnClick={false}
                    onClick={handleReset}
                  >
                    <div className={styles.action}>
                      <Icon icon={RotateCcwIcon} size={14} />
                      <span>{t('workingDirectory.staleResetToSource', { name: reset.name })}</span>
                    </div>
                  </DropdownMenuItem>
                )}
              </DropdownMenuPopup>
            </DropdownMenuPositioner>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
        {pullRequest && (
          <>
            <div className={gitChipStyles.separator} />
            <div className={gitChipStyles.prTrigger} role="button" onClick={handleOpenPr}>
              <Icon icon={GitPullRequest} size={12} />
              <span>#{pullRequest.number}</span>
            </div>
          </>
        )}
      </>
    );
  },
);

StaleGitSnapshot.displayName = 'StaleGitSnapshot';

export default StaleGitSnapshot;
