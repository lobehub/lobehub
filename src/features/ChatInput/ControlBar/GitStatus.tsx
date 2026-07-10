import { Icon, Tooltip } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowDownIcon, ArrowUpIcon, GitPullRequest } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RingLoadingIcon from '@/components/RingLoading';
import { electronSystemService } from '@/services/electron/system';
import { gitService } from '@/services/git';
import {
  useFetchGitAheadBehind,
  useFetchGitBranch,
  useFetchGitLinkedPR,
  useFetchGitWorktrees,
  useReviewPatches,
} from '@/store/device';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import BranchSwitcher from './BranchSwitcher';
import WorktreeSwitcher from './WorktreeSwitcher';

const styles = createStaticStyles(({ css }) => {
  return {
    aheadBehindStat: css`
      display: inline-flex;
      gap: 0;
      align-items: center;

      margin-inline-start: -2px;

      font-variant-numeric: tabular-nums;
      line-height: 1;
    `,
    aheadStat: css`
      color: ${cssVar.colorInfo};
    `,
    behindStat: css`
      color: ${cssVar.colorError};
    `,
    branchGroup: css`
      display: flex;
      flex: none;
      gap: 2px;
      align-items: center;
    `,
    branchLabel: css`
      overflow: hidden;
      max-width: 160px;
      text-overflow: ellipsis;
      white-space: nowrap;
    `,
    diffStat: css`
      display: inline-flex;
      flex-shrink: 0;
      gap: 4px;
      align-items: center;

      font-variant-numeric: tabular-nums;
    `,
    diffStatAdded: css`
      color: ${cssVar.colorSuccess};
    `,
    diffStatDeleted: css`
      color: ${cssVar.colorError};
    `,
    diffStatModified: css`
      color: ${cssVar.colorWarning};
    `,
    prTrigger: css`
      cursor: pointer;

      display: flex;
      flex: none;
      gap: 4px;
      align-items: center;

      padding-block: 2px;
      padding-inline: 4px;
      border-radius: 4px;

      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
      white-space: nowrap;

      transition: background 0.2s;

      &:hover {
        color: ${cssVar.colorText};
        background: ${cssVar.colorFillTertiary};
      }
    `,
    separator: css`
      flex: none;
      width: 1px;
      height: 10px;
      background: ${cssVar.colorSplit};
    `,
    syncTrigger: css`
      cursor: pointer;

      display: inline-flex;
      flex: none;
      gap: 2px;
      align-items: center;

      padding-block: 2px;
      padding-inline: 4px;
      border-radius: 4px;

      font-size: 12px;
      font-variant-numeric: tabular-nums;
      line-height: 1;

      transition: background 0.2s;

      &:hover {
        background: ${cssVar.colorFillTertiary};
      }
    `,
    syncTriggerDisabled: css`
      cursor: progress;
      opacity: 0.6;

      &:hover {
        background: transparent;
      }
    `,
    trigger: css`
      cursor: pointer;

      display: flex;
      flex: none;
      gap: 4px;
      align-items: center;

      padding-block: 2px;
      padding-inline: 4px;
      border-radius: 4px;

      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
      white-space: nowrap;

      transition: background 0.2s;

      &:hover {
        background: ${cssVar.colorFillTertiary};
      }
    `,
  };
});

interface GitStatusProps {
  /** When set, git status / branch switch / pull / push all run against this
   * remote device via RPC. Omit for the local machine (talks over IPC). */
  agentId: string;
  deviceId?: string;
  isGithub: boolean;
  path: string;
  sourcePath?: string;
}

const GitStatus = memo<GitStatusProps>(({ agentId, path, sourcePath, isGithub, deviceId }) => {
  const { t } = useTranslation('device');
  // Transport (Electron IPC vs device RPC) is decided inside the service; the
  // component just reads, identically for local and remote.
  // Branch (cheap, refreshes promptly on dir switch) and the linked-PR lookup
  // (expensive `gh` call, throttled) are deliberately separate cache entries.
  const { data: branchData, mutate: mutateBranch } = useFetchGitBranch(deviceId, path);
  const branch = branchData?.branch;
  const detached = branchData?.detached;
  const { data: prData, mutate: mutatePR } = useFetchGitLinkedPR(deviceId, path, branch, isGithub);
  const { data: reviewPatches, mutate: mutateReviewPatches } = useReviewPatches(
    path,
    'unstaged',
    undefined,
    deviceId,
  );
  const { data: aheadBehind, mutate: mutateAheadBehind } = useFetchGitAheadBehind(deviceId, path);
  const { data: worktrees = [], mutate: mutateWorktrees } = useFetchGitWorktrees(deviceId, path);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);
  const setWorkingSidebarTab = useGlobalStore((s) => s.setWorkingSidebarTab);
  const showRightPanel = useGlobalStore(systemStatusSelectors.showRightPanel);
  const workingSidebarTab = useGlobalStore((s) => s.status.workingSidebarTab);

  const handleOpenPr = useCallback(() => {
    if (prData?.pullRequest?.url) {
      void electronSystemService.openExternalLink(prData.pullRequest.url);
    }
  }, [prData?.pullRequest?.url]);

  const handleToggleReview = useCallback(() => {
    if (showRightPanel && workingSidebarTab === 'review') {
      toggleRightPanel(false);
      return;
    }
    setWorkingSidebarTab('review');
    toggleRightPanel(true);
  }, [showRightPanel, workingSidebarTab, setWorkingSidebarTab, toggleRightPanel]);

  const refreshAfterSync = useCallback(async () => {
    await Promise.all([
      mutateBranch(),
      mutatePR(),
      mutateReviewPatches(),
      mutateAheadBehind(),
      mutateWorktrees(),
    ]);
  }, [mutateBranch, mutatePR, mutateReviewPatches, mutateAheadBehind, mutateWorktrees]);

  // Flip the displayed branch instantly on checkout. No revalidate here — the
  // switcher's onAfterCheckout reconciles once the checkout lands. The linked-PR
  // hook is keyed by branch, so it re-keys to the new branch on its own (its
  // cache starts empty there, hiding the stale PR until the lookup resolves).
  const handleOptimisticCheckout = useCallback(
    (nextBranch: string) => {
      void mutateBranch({ branch: nextBranch, detached: false }, { revalidate: false });
    },
    [mutateBranch],
  );

  const syncBusy = pulling || pushing;

  const handlePull = useCallback(async () => {
    if (pulling || pushing) return;
    setPulling(true);
    try {
      const result = await gitService.pullGitBranch({ deviceId, path });
      if (result.success) {
        if (result.noop) {
          toast.info(t('workingDirectory.pullNoop'));
        } else {
          toast.success(t('workingDirectory.pullSuccess'));
        }
        await refreshAfterSync();
      } else {
        toast.error(result.error || t('workingDirectory.pullFailed'));
      }
    } finally {
      setPulling(false);
    }
  }, [deviceId, path, pulling, pushing, refreshAfterSync, t]);

  const handlePush = useCallback(async () => {
    if (pulling || pushing) return;
    setPushing(true);
    try {
      const result = await gitService.pushGitBranch({ deviceId, path });
      if (result.success) {
        if (result.noop) {
          toast.info(t('workingDirectory.pushNoop'));
        } else {
          toast.success(t('workingDirectory.pushSuccess'));
        }
        await refreshAfterSync();
      } else {
        toast.error(result.error || t('workingDirectory.pushFailed'));
      }
    } finally {
      setPushing(false);
    }
  }, [deviceId, path, pulling, pushing, refreshAfterSync, t]);

  const diffStats = useMemo(() => {
    const patches = [
      ...(reviewPatches?.patches ?? []),
      ...(reviewPatches?.submodules ?? []).flatMap((submodule) => submodule.patches),
    ];
    return patches.reduce(
      (acc, patch) => {
        acc.additions += patch.additions ?? 0;
        acc.deletions += patch.deletions ?? 0;
        acc.files += 1;
        return acc;
      },
      { additions: 0, deletions: 0, files: 0 },
    );
  }, [reviewPatches?.patches, reviewPatches?.submodules]);
  const hasChanges = diffStats.files > 0;

  if (!branch) return null;

  const branchTooltip = detached ? t('workingDirectory.detachedHead', { sha: branch }) : branch;

  const prTooltip = prData?.pullRequest
    ? prData.extraCount
      ? t('workingDirectory.prTooltipWithExtra', {
          count: prData.extraCount,
          title: prData.pullRequest.title,
        })
      : prData.pullRequest.title
    : prData?.ghMissing
      ? t('workingDirectory.ghMissing')
      : undefined;

  const diffStatTooltip = hasChanges
    ? t('workingDirectory.diffLineStatTooltip', {
        added: diffStats.additions,
        deleted: diffStats.deletions,
        files: diffStats.files,
      })
    : undefined;

  const showAhead = !!aheadBehind && aheadBehind.hasUpstream && aheadBehind.ahead > 0;
  const showBehind = !!aheadBehind && aheadBehind.hasUpstream && aheadBehind.behind > 0;
  const upstreamName = aheadBehind?.upstream ?? '';
  const pushTargetName = aheadBehind?.pushTarget ?? '';
  const pushTargetExists = !!aheadBehind?.pushTargetExists;

  const branchTrigger = (
    <div className={styles.trigger}>
      <span className={styles.branchLabel}>{branch}</span>
    </div>
  );

  const hasWorktreeMenu = worktrees.length > 0;

  const worktreeNode = hasWorktreeMenu ? (
    <WorktreeSwitcher
      agentId={agentId}
      currentBranch={branch}
      detached={detached}
      deviceId={deviceId}
      isGithub={isGithub}
      path={path}
      sourcePath={sourcePath ?? path}
      worktrees={worktrees}
      onWorktreesChange={mutateWorktrees}
    />
  ) : null;

  const branchNode = detached ? (
    // Detached HEAD → plain branch label (nothing to switch to).
    <Tooltip title={branchTooltip}>{branchTrigger}</Tooltip>
  ) : (
    // Local switches over IPC; a remote device switches over RPC (deviceId set).
    <BranchSwitcher
      currentBranch={branch}
      deviceId={deviceId}
      open={switcherOpen}
      path={path}
      onExternalRefresh={refreshAfterSync}
      onOpenChange={setSwitcherOpen}
      onOptimisticCheckout={handleOptimisticCheckout}
      onAfterCheckout={() => {
        void mutateBranch();
        void mutatePR();
        void mutateReviewPatches();
        void mutateAheadBehind();
        void mutateWorktrees();
      }}
    >
      <Tooltip title={branchTooltip}>{branchTrigger}</Tooltip>
    </BranchSwitcher>
  );

  const pullTooltip = pulling
    ? t('workingDirectory.pullInProgress')
    : t('workingDirectory.pullAction', {
        count: aheadBehind?.behind ?? 0,
        upstream: upstreamName,
      });

  const pushTooltip = pushing
    ? t('workingDirectory.pushInProgress')
    : t(pushTargetExists ? 'workingDirectory.pushAction' : 'workingDirectory.pushActionNew', {
        count: aheadBehind?.ahead ?? 0,
        target: pushTargetName || upstreamName,
      });

  const pullNode = showBehind && (
    <Tooltip title={pullTooltip}>
      <div
        aria-busy={pulling}
        aria-disabled={syncBusy}
        className={`${styles.syncTrigger} ${styles.behindStat} ${syncBusy ? styles.syncTriggerDisabled : ''}`}
        role="button"
        onClick={syncBusy ? undefined : handlePull}
      >
        <span className={styles.aheadBehindStat}>
          {pulling ? <RingLoadingIcon size={10} /> : <Icon icon={ArrowDownIcon} size={10} />}
          {aheadBehind!.behind}
        </span>
      </div>
    </Tooltip>
  );

  const pushNode = showAhead && (
    <Tooltip title={pushTooltip}>
      <div
        aria-busy={pushing}
        aria-disabled={syncBusy}
        className={`${styles.syncTrigger} ${styles.aheadStat} ${syncBusy ? styles.syncTriggerDisabled : ''}`}
        role="button"
        onClick={syncBusy ? undefined : handlePush}
      >
        <span className={styles.aheadBehindStat}>
          {pushing ? <RingLoadingIcon size={10} /> : <Icon icon={ArrowUpIcon} size={10} />}
          {aheadBehind!.ahead}
        </span>
      </div>
    </Tooltip>
  );

  const diffNode = (() => {
    if (!hasChanges) return null;
    const diffButton = (
      <div className={styles.trigger} role="button" onClick={handleToggleReview}>
        <span className={styles.diffStat}>
          {diffStats.additions > 0 && (
            <span className={styles.diffStatAdded}>+{diffStats.additions}</span>
          )}
          {diffStats.deletions > 0 && (
            <span className={styles.diffStatDeleted}>-{diffStats.deletions}</span>
          )}
          {diffStats.additions === 0 && diffStats.deletions === 0 && diffStats.files > 0 && (
            <span className={styles.diffStatModified}>±{diffStats.files}</span>
          )}
        </span>
      </div>
    );
    return <Tooltip title={diffStatTooltip}>{diffButton}</Tooltip>;
  })();

  return (
    <>
      <div className={styles.separator} />
      {/* The worktree icon and the branch name name one thing — which checkout
       * you're on — so they sit closer to each other than to their neighbours. */}
      <div className={styles.branchGroup}>
        {worktreeNode}
        {branchNode}
      </div>
      {pullNode}
      {pushNode}
      {diffNode}
      {prData?.pullRequest && (
        <>
          <div className={styles.separator} />
          <Tooltip title={prTooltip}>
            <div className={styles.prTrigger} role="button" onClick={handleOpenPr}>
              <Icon icon={GitPullRequest} size={12} />
              <span>#{prData.pullRequest.number}</span>
            </div>
          </Tooltip>
        </>
      )}
    </>
  );
});

GitStatus.displayName = 'GitStatus';

export default GitStatus;
