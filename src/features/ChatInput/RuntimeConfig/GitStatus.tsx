import { Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { GitBranchIcon, GitPullRequest } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';

import BranchSwitcher from './BranchSwitcher';
import { useGitInfo } from './useGitInfo';
import { useWorkingTreeStatus } from './useWorkingTreeStatus';

const styles = createStaticStyles(({ css }) => ({
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

    margin-inline-start: 2px;

    font-variant-numeric: tabular-nums;
    line-height: 1;
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
}));

interface GitStatusProps {
  isGithub: boolean;
  path: string;
}

const GitStatus = memo<GitStatusProps>(({ path, isGithub }) => {
  const { t } = useTranslation('plugin');
  const { data, mutate } = useGitInfo(path, isGithub);
  const { data: workingStatus, mutate: mutateWorkingStatus } = useWorkingTreeStatus(path);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const handleOpenPr = useCallback(() => {
    if (data?.pullRequest?.url) {
      void electronSystemService.openExternalLink(data.pullRequest.url);
    }
  }, [data?.pullRequest?.url]);

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

  const diffStat =
    workingStatus && !workingStatus.clean ? (
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
    ) : null;

  const diffStatTooltip =
    workingStatus && !workingStatus.clean
      ? t('localSystem.workingDirectory.diffStatTooltip', {
          added: workingStatus.added,
          deleted: workingStatus.deleted,
          modified: workingStatus.modified,
        })
      : undefined;

  const branchTrigger = (
    <div className={styles.trigger}>
      <Icon icon={GitBranchIcon} size={12} />
      <span className={styles.branchLabel}>{data.branch}</span>
      {diffStat}
    </div>
  );

  const wrappedBranchTrigger =
    diffStat && diffStatTooltip ? (
      <Tooltip title={diffStatTooltip}>{branchTrigger}</Tooltip>
    ) : (
      branchTrigger
    );

  return (
    <>
      <div className={styles.separator} />
      {data.detached ? (
        <Tooltip title={branchTooltip}>{branchTrigger}</Tooltip>
      ) : (
        <BranchSwitcher
          currentBranch={data.branch}
          open={switcherOpen}
          path={path}
          onOpenChange={setSwitcherOpen}
          onAfterCheckout={() => {
            void mutate();
            void mutateWorkingStatus();
          }}
          onExternalRefresh={async () => {
            await Promise.all([mutate(), mutateWorkingStatus()]);
          }}
        >
          {wrappedBranchTrigger}
        </BranchSwitcher>
      )}
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
