import { Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowDownIcon, ArrowUpIcon, GitBranchIcon, GitPullRequest } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import RingLoadingIcon from '@/components/RingLoading';
import { electronSystemService } from '@/services/electron/system';
import { gitService } from '@/services/git';
import {
  useFetchGitAheadBehind,
  useFetchGitInfo,
  useFetchGitWorkingTreeStatus,
} from '@/store/device';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import BranchSwitcher from './BranchSwitcher';

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
      gap: 4px;
      align-items: center;

      padding-block: 2px;
      padding-inline: 4px;
      border-radius: 4px;

      font-size: 12px;
      color: ${cssVar.colorTextSecondary};

      transition: background 0.2s;

      &:hover {
        color: ${cssVar.colorText};
        background: ${cssVar.colorFillTertiary};
      }
    `,
    separator: css`
      width: 1px;
      height: 10px;
      background: ${cssVar.colorSplit};
    `,
    syncTrigger: css`
      cursor: pointer;

      display: inline-flex;
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
      gap: 4px;
      align-items: center;

      padding-block: 2px;
      padding-inline: 4px;
      border-radius: 4px;

      font-size: 12px;
      color: ${cssVar.colorTextSecondary};

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
  deviceId?: string;
  isGithub: boolean;
  path: string;
}

const GitStatus = memo<GitStatusProps>(({ path, isGithub, deviceId }) => {
  const { t } = useTranslation('device');
  const local = !deviceId;
  // Transport (Electron IPC vs device RPC) is decided inside the service; the
  // component just reads, identically for local and remote.
  const { data, mutate } = useFetchGitInfo(deviceId, path, isGithub);
  const { data: workingStatus, mutate: mutateWorkingStatus } = useFetchGitWorkingTreeStatus(
    deviceId,
    path,
  );
  const { data: aheadBehind, mutate: mutateAheadBehind } = useFetchGitAheadBehind(deviceId, path);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);
  const setWorkingSidebarTab = useGlobalStore((s) => s.setWorkingSidebarTab);
  const showRightPanel = useGlobalStore(systemStatusSelectors.showRightPanel);
  const workingSidebarTab = useGlobalStore((s) => s.status.workingSidebarTab);

  const handleOpenPr = useCallback(() => {
    if (data?.pullRequest?.url) {
      void electronSystemService.openExternalLink(data.pullRequest.url);
    }
  }, [data?.pullRequest?.url]);

  const handleToggleReview = useCallback(() => {
    if (showRightPanel && workingSidebarTab === 'review') {
      toggleRightPanel(false);
      return;
    }
    setWorkingSidebarTab('review');
    toggleRightPanel(true);
  }, [showRightPanel, workingSidebarTab, setWorkingSidebarTab, toggleRightPanel]);

  const refreshAfterSync = useCallback(async () => {
    await Promise.all([mutate(), mutateWorkingStatus(), mutateAheadBehind()]);
  }, [mutate, mutateWorkingStatus, mutateAheadBehind]);

  // Flip the displayed branch instantly on checkout; clear the old branch's PR
  // (the new branch's is unknown until revalidate). No revalidate here — the
  // switcher's onAfterCheckout reconciles once the checkout lands.
  const handleOptimisticCheckout = useCallback(
    (branch: string) => {
      void mutate(
        (prev) => ({
          ...prev,
          branch,
          detached: false,
          extraCount: undefined,
          ghMissing: undefined,
          pullRequest: null,
        }),
        { revalidate: false },
      );
    },
    [mutate],
  );

  const syncBusy = pulling || pushing;

  const handlePull = useCallback(async () => {
    if (pulling || pushing) return;
    setPulling(true);
    try {
      const result = await gitService.pullGitBranch({ deviceId, path });
      if (result.success) {
        if (result.noop) {
          message.info(t('workingDirectory.pullNoop'));
        } else {
          message.success(t('workingDirectory.pullSuccess'));
        }
        await refreshAfterSync();
      } else {
        message.error(result.error || t('workingDirectory.pullFailed'));
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
          message.info(t('workingDirectory.pushNoop'));
        } else {
          message.success(t('workingDirectory.pushSuccess'));
        }
        await refreshAfterSync();
      } else {
        message.error(result.error || t('workingDirectory.pushFailed'));
      }
    } finally {
      setPushing(false);
    }
  }, [deviceId, path, pulling, pushing, refreshAfterSync, t]);

  if (!data?.branch) return null;

  const branchTooltip = data.detached
    ? t('workingDirectory.detachedHead', { sha: data.branch })
    : data.branch;

  const prTooltip = data.pullRequest
    ? data.extraCount
      ? t('workingDirectory.prTooltipWithExtra', {
          count: data.extraCount,
          title: data.pullRequest.title,
        })
      : data.pullRequest.title
    : data.ghMissing
      ? t('workingDirectory.ghMissing')
      : undefined;

  const hasChanges = !!workingStatus && !workingStatus.clean;

  const diffStatTooltip = hasChanges
    ? t('workingDirectory.diffStatTooltip', {
        added: workingStatus!.added,
        deleted: workingStatus!.deleted,
        modified: workingStatus!.modified,
      })
    : undefined;

  const showAhead = !!aheadBehind && aheadBehind.hasUpstream && aheadBehind.ahead > 0;
  const showBehind = !!aheadBehind && aheadBehind.hasUpstream && aheadBehind.behind > 0;
  const upstreamName = aheadBehind?.upstream ?? '';
  const pushTargetName = aheadBehind?.pushTarget ?? '';
  const pushTargetExists = !!aheadBehind?.pushTargetExists;

  const branchTrigger = (
    <div className={styles.trigger}>
      <Icon icon={GitBranchIcon} size={12} />
      <span className={styles.branchLabel}>{data.branch}</span>
    </div>
  );

  const branchNode = data.detached ? (
    // Detached HEAD → plain branch label (nothing to switch to).
    <Tooltip title={branchTooltip}>{branchTrigger}</Tooltip>
  ) : (
    // Local switches over IPC; a remote device switches over RPC (deviceId set).
    <BranchSwitcher
      currentBranch={data.branch}
      deviceId={deviceId}
      open={switcherOpen}
      path={path}
      onExternalRefresh={refreshAfterSync}
      onOpenChange={setSwitcherOpen}
      onOptimisticCheckout={handleOptimisticCheckout}
      onAfterCheckout={() => {
        void mutate();
        void mutateWorkingStatus();
        void mutateAheadBehind();
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
    if (!hasChanges || !workingStatus) return null;
    const diffButton = (
      <div
        className={styles.trigger}
        role={local ? 'button' : undefined}
        onClick={local ? handleToggleReview : undefined}
      >
        <span className={styles.diffStat}>
          {workingStatus.added > 0 && (
            <span className={styles.diffStatAdded}>+{workingStatus.added}</span>
          )}
          {workingStatus.modified > 0 && (
            <span className={styles.diffStatModified}>±{workingStatus.modified}</span>
          )}
          {workingStatus.deleted > 0 && (
            <span className={styles.diffStatDeleted}>-{workingStatus.deleted}</span>
          )}
        </span>
      </div>
    );
    return <Tooltip title={diffStatTooltip}>{diffButton}</Tooltip>;
  })();

  return (
    <>
      <div className={styles.separator} />
      {branchNode}
      {pullNode}
      {pushNode}
      {diffNode}
      {data.pullRequest && (
        <>
          <div className={styles.separator} />
          <Tooltip title={prTooltip}>
            <div className={styles.prTrigger} role="button" onClick={handleOpenPr}>
              <Icon icon={GitPullRequest} size={12} />
              <span>#{data.pullRequest.number}</span>
            </div>
          </Tooltip>
        </>
      )}
    </>
  );
});

GitStatus.displayName = 'GitStatus';

export default GitStatus;
