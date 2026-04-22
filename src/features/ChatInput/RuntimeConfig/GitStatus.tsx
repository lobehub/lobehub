import { Icon, Popover, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowDownIcon, ArrowUpIcon, GitBranchIcon, GitPullRequest } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import RingLoadingIcon from '@/components/RingLoading';
import { electronGitService } from '@/services/electron/git';
import { electronSystemService } from '@/services/electron/system';

import BranchSwitcher from './BranchSwitcher';
import { useGitAheadBehind } from './useGitAheadBehind';
import { useGitInfo } from './useGitInfo';
import { useWorkingTreeStatus } from './useWorkingTreeStatus';
import WorkingTreeFilesContent from './WorkingTreeFilesContent';

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
  isGithub: boolean;
  path: string;
}

const GitStatus = memo<GitStatusProps>(({ path, isGithub }) => {
  const { t } = useTranslation('plugin');
  const { data, mutate } = useGitInfo(path, isGithub);
  const { data: workingStatus, mutate: mutateWorkingStatus } = useWorkingTreeStatus(path);
  const { data: aheadBehind, mutate: mutateAheadBehind } = useGitAheadBehind(path);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);

  const handleOpenPr = useCallback(() => {
    if (data?.pullRequest?.url) {
      void electronSystemService.openExternalLink(data.pullRequest.url);
    }
  }, [data?.pullRequest?.url]);

  const refreshAfterSync = useCallback(async () => {
    await Promise.all([mutate(), mutateWorkingStatus(), mutateAheadBehind()]);
  }, [mutate, mutateWorkingStatus, mutateAheadBehind]);

  const syncBusy = pulling || pushing;

  const handlePull = useCallback(async () => {
    if (pulling || pushing) return;
    setPulling(true);
    try {
      const result = await electronGitService.pullGitBranch({ path });
      if (result.success) {
        if (result.noop) {
          message.info(t('localSystem.workingDirectory.pullNoop'));
        } else {
          message.success(t('localSystem.workingDirectory.pullSuccess'));
        }
        await refreshAfterSync();
      } else {
        message.error(result.error || t('localSystem.workingDirectory.pullFailed'));
      }
    } finally {
      setPulling(false);
    }
  }, [path, pulling, pushing, refreshAfterSync, t]);

  const handlePush = useCallback(async () => {
    if (pulling || pushing) return;
    setPushing(true);
    try {
      const result = await electronGitService.pushGitBranch({ path });
      if (result.success) {
        if (result.noop) {
          message.info(t('localSystem.workingDirectory.pushNoop'));
        } else {
          message.success(t('localSystem.workingDirectory.pushSuccess'));
        }
        await refreshAfterSync();
      } else {
        message.error(result.error || t('localSystem.workingDirectory.pushFailed'));
      }
    } finally {
      setPushing(false);
    }
  }, [path, pulling, pushing, refreshAfterSync, t]);

  if (!data?.branch) return null;

  const branchTooltip = data.detached
    ? t('localSystem.workingDirectory.detachedHead', { sha: data.branch })
    : data.branch;

  const prTooltip = data.pullRequest
    ? data.extraCount
      ? t('localSystem.workingDirectory.prTooltipWithExtra', {
          count: data.extraCount,
          title: data.pullRequest.title,
        })
      : data.pullRequest.title
    : data.ghMissing
      ? t('localSystem.workingDirectory.ghMissing')
      : undefined;

  const hasChanges = !!workingStatus && !workingStatus.clean;

  const diffStatTooltip = hasChanges
    ? t('localSystem.workingDirectory.diffStatTooltip', {
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
    <Tooltip title={branchTooltip}>{branchTrigger}</Tooltip>
  ) : (
    <BranchSwitcher
      currentBranch={data.branch}
      open={switcherOpen}
      path={path}
      onExternalRefresh={refreshAfterSync}
      onOpenChange={setSwitcherOpen}
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
    ? t('localSystem.workingDirectory.pullInProgress')
    : t('localSystem.workingDirectory.pullAction', {
        count: aheadBehind?.behind ?? 0,
        upstream: upstreamName,
      });

  const pushTooltip = pushing
    ? t('localSystem.workingDirectory.pushInProgress')
    : t(
        pushTargetExists
          ? 'localSystem.workingDirectory.pushAction'
          : 'localSystem.workingDirectory.pushActionNew',
        {
          count: aheadBehind?.ahead ?? 0,
          target: pushTargetName || upstreamName,
        },
      );

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
      <div className={styles.trigger} role="button">
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
    return (
      <Popover
        arrow={false}
        content={<WorkingTreeFilesContent enabled={filesOpen} path={path} />}
        open={filesOpen}
        placement="bottomLeft"
        styles={{ content: { padding: 0 } }}
        trigger="click"
        onOpenChange={setFilesOpen}
      >
        <div>
          {filesOpen ? diffButton : <Tooltip title={diffStatTooltip}>{diffButton}</Tooltip>}
        </div>
      </Popover>
    );
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
