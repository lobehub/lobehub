import type { WorkingDirGitState } from '@lobechat/types';
import {
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  Icon,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { GitBranchIcon, GitForkIcon, GitPullRequest, RotateCcwIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

import { gitChipStyles } from './gitChipStyles';
import { resolveStaleSnapshot } from './staleSnapshot';
import { useSwitchWorktree } from './useSwitchWorktree';

const styles = stylex.create({
  action: { display: 'flex', gap: '8px', alignItems: 'center' },
  explanation: {
    maxWidth: '320px',
    paddingBlockStart: '6px',
    paddingBlockEnd: '8px',
    paddingInline: '10px',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
  },
  path: {
    display: 'block',
    marginBlockStart: '2px',
    fontFamily: cssVar.fontFamilyCode,
    color: cssVar.colorTextTertiary,
    wordBreak: 'break-all',
  },
  popup: { padding: '0' },
  triggerLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

interface StaleGitSnapshotProps {
  agentId: string;
  /** The topic's persisted git context — the only source here; nothing is probed. */
  git: WorkingDirGitState;
  isGithub: boolean;
  /** The recorded effective directory, i.e. the one that no longer exists. */
  path: string;
  /** The source repo the worktree was linked from, when the topic recorded one. */
  sourcePath?: string;
  /** The conversation the switch is recorded on; omitted, the global active topic. */
  topicId?: string | null;
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
  ({ agentId, git, isGithub, path, sourcePath, topicId }) => {
    const { t } = useTranslation('device');
    const [open, setOpen] = useState(false);
    const [resetting, setResetting] = useState(false);
    const switchWorktree = useSwitchWorktree({
      agentId,
      isGithub,
      sourcePath: sourcePath ?? path,
      topicId,
    });

    const { explanation, isWorktree, label, pullRequest, reset, worktreePath } =
      resolveStaleSnapshot({ git, path, sourcePath });

    const handleOpenPr = useCallback(() => {
      if (pullRequest?.url) {
        openTrustedExternalUrl(pullRequest.url);
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
      <div {...stylex.props(gitChipStyles.staleTrigger)}>
        <Icon icon={isWorktree ? GitForkIcon : GitBranchIcon} size={12} />
        <span {...stylex.props(styles.triggerLabel)}>{label}</span>
      </div>
    );

    return (
      <>
        <div {...stylex.props(gitChipStyles.separator)} />
        <DropdownMenuRoot open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger>
            <div>{trigger}</div>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuPositioner placement="topLeft" sideOffset={8}>
              <DropdownMenuPopup className={stylex.props(styles.popup).className}>
                <div {...stylex.props(styles.explanation)}>
                  {t(explanation.key, explanation.values)}
                  <span {...stylex.props(styles.path)}>{worktreePath}</span>
                </div>
                {reset && (
                  <DropdownMenuItem
                    aria-disabled={resetting}
                    closeOnClick={false}
                    onClick={handleReset}
                  >
                    <div {...stylex.props(styles.action)}>
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
            <div {...stylex.props(gitChipStyles.separator)} />
            <div {...stylex.props(gitChipStyles.prTrigger)} role="button" onClick={handleOpenPr}>
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
