import type { WorkingDirGitState } from '@lobechat/types';
import { createStaticStyles, cssVar, Icon, toast, Tooltip } from '@lobehub/ui';
import { ArrowDownIcon, ArrowUpIcon, GitPullRequest } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RingLoadingIcon from '@/components/RingLoading';
import { gitService } from '@/services/git';
import {
  deviceSelectors,
  useDeviceStore,
  useFetchGitAheadBehind,
  useFetchGitBranch,
  useFetchGitDiffStats,
  useFetchGitLinkedPR,
  useFetchGitWorktrees,
  useReviewPatches,
} from '@/store/device';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

import BranchSwitcher from './BranchSwitcher';
import { gitChipStyles } from './gitChipStyles';
import StaleGitSnapshot from './StaleGitSnapshot';
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
  };
});

interface GitStatusProps {
  /** When set, git status / branch switch / pull / push all run against this
   * remote device via RPC. Omit for the local machine (talks over IPC). */
  agentId: string;
  deviceId?: string;
  /**
   * Git context persisted on the topic. Stands in for the live probe in two
   * cases: while the probe is still pending (no cached branch yet), it paints a
   * read-only branch / PR chip so the cluster doesn't pop in once the read lands;
   * and when the probe finds no branch at `path` — which happens whenever the
   * recorded worktree directory has since been deleted — it keeps the branch /
   * worktree / PR chips visible (read-only) instead of collapsing the whole
   * cluster, so the bar agrees with the topic's meta hover card, which reads
   * this same snapshot and never probes.
   */
  fallbackGit?: WorkingDirGitState;
  isGithub: boolean;
  path: string;
  sourcePath?: string;
  /** The conversation the switch is recorded on; omitted, the global active topic. */
  topicId?: string | null;
}

const GitStatus = memo<GitStatusProps>(
  ({ agentId, path, sourcePath, isGithub, deviceId, fallbackGit, topicId }) => {
    const { t } = useTranslation('device');
    // Transport (Electron IPC vs device RPC) is decided inside the service; the
    // component just reads, identically for local and remote.
    // Branch (cheap, refreshes promptly on dir switch) and the linked-PR lookup
    // (expensive `gh` call, throttled) are deliberately separate cache entries.
    const {
      data: branchData,
      error: branchError,
      isConfirmed: branchConfirmed,
      mutate: mutateBranch,
    } = useFetchGitBranch(deviceId, path);
    const branch = branchData?.branch;
    const detached = branchData?.detached;
    // The persisted snapshot only stands in once the current probe has actually
    // ANSWERED. A hydrated row (`data !== undefined`) is a paint-only stand-in,
    // not an answer: treating it as settled would classify a dead directory
    // from the last session before this session's read returns.
    // `getGitBranch` resolves to `{}` for a path it can't read, so a settled
    // probe is a confirmed read (or an errored one) — keying off `!branch` alone
    // would flash the snapshot cluster on every mount while loading.
    const probeSettled = branchConfirmed || !!branchError;
    // …and only when the probe could reach the directory at all. A remote read
    // whose device is offline (or whose RPC failed) comes back `undefined`, which
    // the service normalizes into the SAME empty shape a deleted path produces —
    // so an unreachable device would otherwise be reported as a missing directory,
    // offering to drop a worktree override that is perfectly alive. A local read
    // talks to this filesystem directly and has no such ambiguity.
    const deviceOnline = useDeviceStore(
      (s) => !!deviceSelectors.getDeviceById(deviceId)(s)?.online,
    );
    const probeReachedDirectory = !deviceId || deviceOnline;
    // Only a CONFIRMED empty probe may declare the directory gone. A hydrated
    // empty row (`{}`) means the last session couldn't read it, not that it is
    // gone now.
    const probeFoundNothing = !branch && branchConfirmed && probeReachedDirectory;
    // Worktrees picked from the bar were persisted without a branch, so the
    // recorded worktree is all such a snapshot has. An empty probe alone can't
    // condemn it: a remote read that fails in transit on a device still marked
    // online comes back just as empty. Ask the source repo instead — the worktree
    // is gone only when the source answers (a real listing always includes the
    // source itself; a failed RPC is `[]`) and no longer lists it as live.
    const recordedWorktree =
      !fallbackGit?.branch && sourcePath && sourcePath !== path
        ? fallbackGit?.activeWorktree
        : undefined;
    const { data: sourceWorktrees, isConfirmed: sourceWorktreesConfirmed } = useFetchGitWorktrees(
      deviceId,
      probeFoundNothing && recordedWorktree ? sourcePath : undefined,
    );
    // Only this session's answer may condemn the recorded worktree; a hydrated
    // listing from the previous session is a paint-only stand-in.
    const recordedWorktreeGone =
      sourceWorktreesConfirmed &&
      !!sourceWorktrees?.length &&
      !sourceWorktrees.some((worktree) => worktree.path === path && !worktree.prunable);
    const isStale =
      probeFoundNothing && (!!fallbackGit?.branch || (!!recordedWorktree && recordedWorktreeGone));
    const { data: prData, mutate: mutatePR } = useFetchGitLinkedPR(
      deviceId,
      path,
      branch,
      isGithub,
    );
    // The remaining reads are all disabled once the directory is gone: nothing
    // below renders from them in that state, and the diff poll alone would keep
    // shelling out to git every 10s — one RPC round-trip per tick on a remote
    // device — against a path we already know cannot be read.
    const { data: reviewPatches, mutate: mutateReviewPatches } = useReviewPatches(
      path,
      'unstaged',
      undefined,
      deviceId,
      !isStale,
    );
    // The `+N −M` chip is derived from the review patches (a separate read), so
    // persist only its compact counts. That lets a reload paint the previous
    // session's chip instead of growing the cluster after the diff arrives.
    const { data: cachedDiffStats, set: setDiffStats } = useFetchGitDiffStats(deviceId, path);
    const livePath = isStale ? undefined : path;
    const {
      data: aheadBehind,
      isConfirmed: aheadBehindConfirmed,
      mutate: mutateAheadBehind,
    } = useFetchGitAheadBehind(deviceId, livePath);
    const {
      data: worktrees = [],
      isConfirmed: worktreesConfirmed,
      mutate: mutateWorktrees,
    } = useFetchGitWorktrees(deviceId, livePath);
    const [switcherOpen, setSwitcherOpen] = useState(false);
    const [pulling, setPulling] = useState(false);
    const [pushing, setPushing] = useState(false);
    const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);
    const openWorkingSidebar = useGlobalStore((s) => s.openWorkingSidebar);
    const showRightPanel = useGlobalStore(systemStatusSelectors.showRightPanel);
    const workingSidebarTab = useGlobalStore((s) => s.status.workingSidebarTab);

    // Until the linked-PR lookup answers for this branch, reuse the PR the topic
    // recorded for the same branch so the PR chip doesn't pop in late.
    const pullRequest =
      prData !== undefined
        ? prData.pullRequest
        : isGithub &&
            (!branch || branch === fallbackGit?.branch) &&
            fallbackGit?.github?.pullRequest
          ? fallbackGit.github.pullRequest
          : undefined;

    const handleOpenPr = useCallback(() => {
      if (pullRequest?.url) {
        openTrustedExternalUrl(pullRequest.url);
      }
    }, [pullRequest?.url]);

    const handleToggleReview = useCallback(() => {
      if (showRightPanel && workingSidebarTab === 'review') {
        toggleRightPanel(false);
        return;
      }
      openWorkingSidebar('review');
    }, [openWorkingSidebar, showRightPanel, workingSidebarTab, toggleRightPanel]);

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
    // Stale-first paints the last branch and its counts immediately, but
    // checkout / pull / push assume both still describe the live branch. When
    // the repo was switched externally, the faster branch probe can confirm the
    // NEW branch while the ahead/behind snapshot still belongs to the OLD one —
    // acting then would pull/push the actual branch while the label and counts
    // describe another. Keep them inert until BOTH reads answer; the chips stay
    // visible either way.
    const actionsBlocked = syncBusy || !branchConfirmed || !aheadBehindConfirmed;
    // Both pickers consume the worktree list (the branch picker routes to the
    // worktree that already holds the branch), so it must be this session's
    // listing too — a stale one can point at a removed worktree.
    const pickersReady = branchConfirmed && worktreesConfirmed;

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

    const liveDiffStats = useMemo(() => {
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
    // Persist the confirmed counts; an empty answer (no patches) also replaces
    // the stale chip.
    useEffect(() => {
      if (reviewPatches !== undefined) setDiffStats(liveDiffStats);
    }, [reviewPatches, liveDiffStats, setDiffStats]);
    const diffStats =
      reviewPatches !== undefined ? liveDiffStats : (cachedDiffStats ?? liveDiffStats);
    const hasChanges = diffStats.files > 0;

    // Dead directory: the whole live cluster is unreachable, so hand off to the
    // snapshot renderer — it shows what the topic recorded and offers the one
    // action that can still work (drop the worktree override).
    if (isStale) {
      return (
        <StaleGitSnapshot
          agentId={agentId}
          git={fallbackGit!}
          isGithub={isGithub}
          path={path}
          sourcePath={sourcePath}
          topicId={topicId}
        />
      );
    }

    if (!branch) {
      // Probe still pending: paint the topic's recorded branch / PR read-only
      // (not the dead-directory snapshot — nothing is known to be gone yet).
      if (!probeSettled && fallbackGit?.branch) {
        return (
          <>
            <div className={gitChipStyles.separator} />
            <div aria-busy className={styles.branchGroup}>
              <div className={gitChipStyles.trigger}>
                <span className={styles.branchLabel}>{fallbackGit.branch}</span>
              </div>
            </div>
            {pullRequest && (
              <>
                <div className={gitChipStyles.separator} />
                <Tooltip title={pullRequest.title}>
                  <div className={gitChipStyles.prTrigger} role="button" onClick={handleOpenPr}>
                    <Icon icon={GitPullRequest} size={12} />
                    <span>#{pullRequest.number}</span>
                  </div>
                </Tooltip>
              </>
            )}
          </>
        );
      }
      return null;
    }

    const branchTooltip = detached ? t('workingDirectory.detachedHead', { sha: branch }) : branch;

    const prTooltip = pullRequest
      ? prData?.extraCount
        ? t('workingDirectory.prTooltipWithExtra', {
            count: prData.extraCount,
            title: pullRequest.title,
          })
        : pullRequest.title
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
      <div className={gitChipStyles.trigger}>
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
        disabled={!pickersReady}
        isGithub={isGithub}
        path={path}
        sourcePath={sourcePath ?? path}
        topicId={topicId}
        worktrees={worktrees}
        onWorktreesChange={mutateWorktrees}
      />
    ) : null;

    const branchNode = detached ? (
      // Detached HEAD → plain branch label (nothing to switch to).
      <Tooltip title={branchTooltip}>{branchTrigger}</Tooltip>
    ) : !pickersReady ? (
      // Hydrated from the last session: hold the checkout entry until this
      // session's branch AND worktree probes answer, so the switcher's "current"
      // branch and its worktree routing are not stale guesses.
      <Tooltip title={t('workingDirectory.branchConfirming')}>{branchTrigger}</Tooltip>
    ) : (
      // Local switches over IPC; a remote device switches over RPC (deviceId set).
      <BranchSwitcher
        agentId={agentId}
        currentBranch={branch}
        deviceId={deviceId}
        isGithub={isGithub}
        open={switcherOpen}
        path={path}
        sourcePath={sourcePath ?? path}
        topicId={topicId}
        worktrees={worktrees}
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
          aria-disabled={actionsBlocked}
          className={`${styles.syncTrigger} ${styles.behindStat} ${actionsBlocked ? styles.syncTriggerDisabled : ''}`}
          role="button"
          onClick={actionsBlocked ? undefined : handlePull}
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
          aria-disabled={actionsBlocked}
          className={`${styles.syncTrigger} ${styles.aheadStat} ${actionsBlocked ? styles.syncTriggerDisabled : ''}`}
          role="button"
          onClick={actionsBlocked ? undefined : handlePush}
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
        <div className={gitChipStyles.trigger} role="button" onClick={handleToggleReview}>
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
        <div className={gitChipStyles.separator} />
        {/* The worktree icon and the branch name name one thing — which checkout
         * you're on — so they sit closer to each other than to their neighbours. */}
        <div className={styles.branchGroup}>
          {worktreeNode}
          {branchNode}
        </div>
        {pullNode}
        {pushNode}
        {diffNode}
        {pullRequest && (
          <>
            <div className={gitChipStyles.separator} />
            <Tooltip title={prTooltip}>
              <div className={gitChipStyles.prTrigger} role="button" onClick={handleOpenPr}>
                <Icon icon={GitPullRequest} size={12} />
                <span>#{pullRequest.number}</span>
              </div>
            </Tooltip>
          </>
        )}
      </>
    );
  },
);

GitStatus.displayName = 'GitStatus';

export default GitStatus;
