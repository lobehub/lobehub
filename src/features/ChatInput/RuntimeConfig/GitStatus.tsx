import { Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { GitBranchIcon, GitPullRequest, RefreshCwIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';

import BranchSwitcher from './BranchSwitcher';
import { useGitInfo } from './useGitInfo';

const styles = createStaticStyles(({ css }) => ({
  branch: css`
    overflow: hidden;

    max-width: 160px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  branchTrigger: css`
    cursor: pointer;

    display: flex;
    gap: 4px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border-radius: 4px;

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  refreshButton: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    opacity: 0;

    transition:
      opacity 0.2s,
      background 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  segment: css`
    display: flex;
    gap: 4px;
    align-items: center;

    height: 28px;
    padding-inline: 2px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover .git-status-refresh {
      opacity: 1;
    }
  `,
  separator: css`
    width: 1px;
    height: 10px;
    background: ${cssVar.colorSplit};
  `,
  spinning: css`
    animation: git-status-spin 0.8s linear infinite;

    @keyframes git-status-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
  pr: css`
    cursor: pointer;

    display: flex;
    gap: 4px;
    align-items: center;

    height: 28px;
    padding-inline: 6px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

interface GitStatusProps {
  isGithub: boolean;
  path: string;
}

const GitStatus = memo<GitStatusProps>(({ path, isGithub }) => {
  const { t } = useTranslation('plugin');
  const { data, mutate, isValidating } = useGitInfo(path, isGithub);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const handleRefresh = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsRefreshing(true);
      try {
        await mutate();
      } finally {
        setIsRefreshing(false);
      }
    },
    [mutate],
  );

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

  const branchTrigger = (
    <div className={styles.branchTrigger}>
      <Icon icon={GitBranchIcon} size={12} />
      <span className={styles.branch}>{data.branch}</span>
    </div>
  );

  return (
    <>
      <div className={styles.separator} />
      <div className={styles.segment}>
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
            }}
          >
            {branchTrigger}
          </BranchSwitcher>
        )}
        <Tooltip title={t('localSystem.workingDirectory.refreshGitStatus')}>
          <div
            className={`git-status-refresh ${styles.refreshButton}`}
            role="button"
            onClick={handleRefresh}
          >
            <Icon
              className={isValidating || isRefreshing ? styles.spinning : undefined}
              icon={RefreshCwIcon}
              size={11}
            />
          </div>
        </Tooltip>
      </div>
      {data.pullRequest && (
        <Tooltip title={prTooltip}>
          <div className={styles.pr} role="button" onClick={handleOpenPr}>
            <Icon icon={GitPullRequest} size={12} />
            <span>#{data.pullRequest.number}</span>
          </div>
        </Tooltip>
      )}
    </>
  );
});

GitStatus.displayName = 'GitStatus';

export default GitStatus;
