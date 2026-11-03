'use client';

import type { DeviceGitWorktreeListItem } from '@lobechat/types';
import { Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { GitBranchIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchGitBranch } from '@/store/device';

import BranchSwitcher from './BranchSwitcher';
import { gitChipStyles } from './gitChipStyles';
import { getStagedBranchState } from './stagedBranchState';
import { useStagedProjectGitTarget } from './useStagedProjectGitTarget';

const styles = stylex.create({
  branchGroup: { display: 'flex', flex: 'none', gap: '2px', alignItems: 'center' },
  // Same footprint as the worktree trigger it stands in for, without the menu.
  branchIcon: {
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '22px',
    color: cssVar.colorTextSecondary,
  },
  branchLabel: {
    overflow: 'hidden',
    maxWidth: '160px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/** No worktree routing before the first send: nothing could record the pick. */
const NO_WORKTREES: DeviceGitWorktreeListItem[] = [];

interface StagedBranchStatusProps {
  agentId: string;
}

/**
 * The branch of the project directory a blank conversation is staged in, with
 * an in-place checkout. Only the branch: the review, worktree and PR surfaces
 * of `GitStatus` act on the conversation's recorded directory, which does not
 * exist until the first send creates the topic.
 */
const StagedBranchStatus = memo<StagedBranchStatusProps>(({ agentId }) => {
  const { t } = useTranslation('device');
  const target = useStagedProjectGitTarget(agentId);
  const { data, isConfirmed, mutate } = useFetchGitBranch(target?.deviceId, target?.path);
  const [open, setOpen] = useState(false);

  const handleOptimisticCheckout = useCallback(
    (branch: string) => {
      void mutate({ branch, detached: false }, { revalidate: false });
    },
    [mutate],
  );

  const state = getStagedBranchState(data, isConfirmed);
  if (!target || state === 'hidden') return null;
  const branch = data!.branch!;

  const trigger = (
    <div {...stylex.props(gitChipStyles.trigger)}>
      <span {...stylex.props(styles.branchLabel)}>{branch}</span>
    </div>
  );

  return (
    <>
      <div {...stylex.props(gitChipStyles.separator)} />
      <div {...stylex.props(styles.branchGroup)}>
        <span {...stylex.props(styles.branchIcon)}>
          <Icon icon={GitBranchIcon} size={13} />
        </span>
        {state === 'detached' ? (
          <Tooltip title={t('workingDirectory.detachedHead', { sha: branch })}>{trigger}</Tooltip>
        ) : state === 'confirming' ? (
          <Tooltip title={t('workingDirectory.branchConfirming')}>{trigger}</Tooltip>
        ) : (
          <BranchSwitcher
            agentId={agentId}
            currentBranch={branch}
            deviceId={target.deviceId}
            isGithub={target.isGithub}
            open={open}
            path={target.path}
            sourcePath={target.path}
            topicId={null}
            worktrees={NO_WORKTREES}
            onAfterCheckout={() => void mutate()}
            onOpenChange={setOpen}
            onOptimisticCheckout={handleOptimisticCheckout}
          >
            <Tooltip title={branch}>{trigger}</Tooltip>
          </BranchSwitcher>
        )}
      </div>
    </>
  );
});

StagedBranchStatus.displayName = 'StagedBranchStatus';

export default StagedBranchStatus;
