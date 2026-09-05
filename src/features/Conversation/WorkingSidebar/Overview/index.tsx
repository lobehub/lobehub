'use client';

import { Empty, Flexbox, Icon, type IconProps, Tooltip } from '@lobehub/ui';
import { ActionIcon, Button, Skeleton, toast } from '@lobehub/ui/base-ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoxesIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  FileTextIcon,
  FolderGit2Icon,
  GitBranchIcon,
  GitForkIcon,
  LaptopIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RingLoadingIcon from '@/components/RingLoading';
import {
  getCiVisual,
  getPullRequestState,
  PR_STATE_VISUAL,
} from '@/features/AgentSidebar/Topic/List/Item/metaCardData';
import BranchSwitcher from '@/features/ChatInput/ControlBar/BranchSwitcher';
import WorktreeSwitcher from '@/features/ChatInput/ControlBar/WorktreeSwitcher';
import { getAllWorkSummaries } from '@/features/Conversation/store/slices/data/workSummaries';
import WorkSummaryCard from '@/features/Work/WorkSummaryCard';
import { electronSystemService } from '@/services/electron/system';
import { gitService } from '@/services/git';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { dbMessageSelectors } from '@/store/chat/selectors';
import {
  useFetchGitAheadBehind,
  useFetchGitBranch,
  useFetchGitLinkedPR,
  useFetchGitWorktrees,
  useReviewPatches,
} from '@/store/device';

import ProgressSection from '../ProgressSection';
import { collectChangeStats, isLinkedWorktreeCheckout, shouldShowCiLabel } from './overviewData';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow-y: auto;
    padding-block: 4px 10px;
    padding-inline: 8px;
  `,
  changeAdditions: css`
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorSuccess};
  `,
  changeDeletions: css`
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorError};
  `,
  divider: css`
    flex-shrink: 0;

    height: 1px;
    margin-block: 6px;
    margin-inline: 8px;

    background: ${cssVar.colorBorderSecondary};
  `,
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  row: css`
    cursor: pointer;

    flex-shrink: 0;

    min-height: 32px;
    padding-block: 5px;
    padding-inline: 8px;
    border-radius: 6px;

    transition: background-color 0.12s ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  rowStatic: css`
    cursor: default;

    &:hover {
      background: transparent;
    }
  `,
  rowTrailing: css`
    display: flex;
    flex-shrink: 0;
    gap: 6px;
    align-items: center;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
  `,
  rowValue: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 13px;
    line-height: 20px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  rowValueDanger: css`
    color: ${cssVar.colorError};
  `,
  sectionHeader: css`
    padding-block: 4px 6px;
    padding-inline: 10px;
  `,
  sectionTitle: css`
    font-size: 10.5px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.08em;
  `,
  skeleton: css`
    padding-block: 4px;
    padding-inline: 10px;
  `,
  weakLabel: css`
    font-size: 12px;
    line-height: 18px;
  `,
  weakRow: css`
    cursor: pointer;

    flex-shrink: 0;

    min-height: 28px;
    padding-block: 3px;
    padding-inline: 8px;
    border-radius: 6px;

    color: ${cssVar.colorTextSecondary};

    transition: background-color 0.12s ease;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface OverviewProps {
  active: boolean;
  /** Enables the branch / worktree switchers; without it those rows are read-only. */
  agentId?: string;
  deviceId?: string;
  environmentAvailable: boolean;
  onOpenTab: (tab: string) => void;
  repoType?: string;
  /** The repo the conversation is anchored to (worktrees hang off it). */
  sourcePath?: string;
  workingDirectory?: string;
}

const pathBasename = (path: string) => path.replaceAll('\\', '/').split('/').findLast(Boolean);

interface OverviewRowProps {
  danger?: boolean;
  icon: IconProps['icon'];
  iconColor?: string;
  /** Row LOOKS clickable but the click is handled by a wrapping dropdown trigger. */
  interactive?: boolean;
  onClick?: () => void;
  title?: string;
  trailing?: ReactNode;
  value: ReactNode;
}

/**
 * The panel's single row grammar: `icon + value + trailing`. The value column is
 * the fact itself (branch name, PR title), never a noun label describing it; the
 * trailing column holds exactly one of a number, a status, or a chevron.
 */
const OverviewRow = memo<OverviewRowProps>(
  ({ danger, icon, iconColor, interactive, onClick, title, trailing, value }) => (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.row, !onClick && !interactive && styles.rowStatic)}
      gap={10}
      role={onClick || interactive ? 'button' : undefined}
      onClick={onClick}
    >
      <Icon
        className={styles.icon}
        icon={icon}
        size={16}
        style={iconColor ? { color: iconColor } : undefined}
      />
      <span className={cx(styles.rowValue, danger && styles.rowValueDanger)} title={title}>
        {value}
      </span>
      {trailing ? <span className={styles.rowTrailing}>{trailing}</span> : null}
    </Flexbox>
  ),
);

OverviewRow.displayName = 'OverviewRow';

const Chevron = () => <Icon icon={ChevronDownIcon} size={14} style={{ opacity: 0.6 }} />;

const Overview = memo<OverviewProps>(
  ({
    active,
    agentId,
    deviceId,
    environmentAvailable,
    onOpenTab,
    repoType,
    sourcePath,
    workingDirectory,
  }) => {
    const { t } = useTranslation('chat');
    const { t: tDevice } = useTranslation('device');
    const { t: tCommon } = useTranslation('common');
    const isHetero = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
    const topicId = useChatStore((s) => s.activeTopicId);
    const threadId = useChatStore((s) => s.activeThreadId);
    const works = useChatStore((s) =>
      getAllWorkSummaries(dbMessageSelectors.activeDbMessages(s), threadId),
    );

    const gitPath = active && repoType ? workingDirectory : undefined;
    const isGithub = repoType === 'github';
    const {
      data: branchData,
      error: branchError,
      isLoading: branchLoading,
      mutate: mutateBranch,
    } = useFetchGitBranch(deviceId, gitPath);
    const branch = branchData?.branch;
    const detached = branchData?.detached;
    const {
      data: aheadBehind,
      error: aheadBehindError,
      mutate: mutateAheadBehind,
    } = useFetchGitAheadBehind(deviceId, gitPath);
    const {
      data: reviewData,
      error: reviewError,
      isLoading: reviewLoading,
      mutate: mutateReview,
    } = useReviewPatches(gitPath, 'unstaged', undefined, deviceId, active);
    const { data: worktrees = [], mutate: mutateWorktrees } = useFetchGitWorktrees(
      deviceId,
      gitPath,
    );
    const { data: prData, mutate: mutatePR } = useFetchGitLinkedPR(
      deviceId,
      gitPath,
      branch,
      isGithub,
    );

    const [switcherOpen, setSwitcherOpen] = useState(false);
    const [pulling, setPulling] = useState(false);
    const [pushing, setPushing] = useState(false);

    const changeStats = useMemo(() => collectChangeStats(reviewData), [reviewData]);

    const gitError = branchError || aheadBehindError || reviewError;
    const isGitLoading = branchLoading || reviewLoading;
    const visibleWorks = works.slice(0, 3);
    const directoryName = workingDirectory ? pathBasename(workingDirectory) : undefined;

    const isLinkedWorktree = isLinkedWorktreeCheckout(workingDirectory, worktrees);

    const refreshGit = useCallback(async () => {
      await Promise.all([
        mutateBranch(),
        mutateAheadBehind(),
        mutateReview(),
        mutateWorktrees(),
        mutatePR(),
      ]);
    }, [mutateBranch, mutateAheadBehind, mutateReview, mutateWorktrees, mutatePR]);

    // Flip the displayed branch instantly on checkout; the switcher's
    // onAfterCheckout reconciles once the checkout lands (same as GitStatus).
    const handleOptimisticCheckout = useCallback(
      (nextBranch: string) => {
        void mutateBranch({ branch: nextBranch, detached: false }, { revalidate: false });
      },
      [mutateBranch],
    );

    const syncBusy = pulling || pushing;

    const handlePull = useCallback(async () => {
      if (syncBusy || !workingDirectory) return;
      setPulling(true);
      try {
        const result = await gitService.pullGitBranch({ deviceId, path: workingDirectory });
        if (result.success) {
          if (result.noop) {
            toast.info(tDevice('workingDirectory.pullNoop'));
          } else {
            toast.success(tDevice('workingDirectory.pullSuccess'));
          }
          await refreshGit();
        } else {
          toast.error(result.error || tDevice('workingDirectory.pullFailed'));
        }
      } finally {
        setPulling(false);
      }
    }, [deviceId, refreshGit, syncBusy, tDevice, workingDirectory]);

    const handlePush = useCallback(async () => {
      if (syncBusy || !workingDirectory) return;
      setPushing(true);
      try {
        const result = await gitService.pushGitBranch({ deviceId, path: workingDirectory });
        if (result.success) {
          if (result.noop) {
            toast.info(tDevice('workingDirectory.pushNoop'));
          } else {
            toast.success(tDevice('workingDirectory.pushSuccess'));
          }
          await refreshGit();
        } else {
          toast.error(result.error || tDevice('workingDirectory.pushFailed'));
        }
      } finally {
        setPushing(false);
      }
    }, [deviceId, refreshGit, syncBusy, tDevice, workingDirectory]);

    const pullRequest = prData?.pullRequest;
    const ciStatus = pullRequest?.ciStatus;
    const ci = pullRequest ? getCiVisual(ciStatus) : undefined;
    const prVisual = pullRequest ? PR_STATE_VISUAL[getPullRequestState(pullRequest)] : undefined;

    const showAhead = !!aheadBehind?.hasUpstream && aheadBehind.ahead > 0;
    const showBehind = !!aheadBehind?.hasUpstream && aheadBehind.behind > 0;

    const branchRow = (
      <OverviewRow
        icon={GitBranchIcon}
        interactive={!detached && !!agentId && !!workingDirectory}
        title={detached ? tDevice('workingDirectory.detachedHead', { sha: branch ?? '' }) : branch}
        trailing={!detached && agentId ? <Chevron /> : undefined}
        value={branch}
      />
    );

    const gitRows = (
      <>
        {/* Branch: the value owns the main column; switching happens in place. */}
        {branch &&
          (!detached && agentId && workingDirectory ? (
            <BranchSwitcher
              agentId={agentId}
              currentBranch={branch}
              deviceId={deviceId}
              isGithub={isGithub}
              open={switcherOpen}
              path={workingDirectory}
              placement={'bottomLeft'}
              sourcePath={sourcePath ?? workingDirectory}
              worktrees={worktrees}
              onAfterCheckout={() => void refreshGit()}
              onExternalRefresh={refreshGit}
              onOpenChange={setSwitcherOpen}
              onOptimisticCheckout={handleOptimisticCheckout}
            >
              {branchRow}
            </BranchSwitcher>
          ) : (
            branchRow
          ))}

        {/* Worktree: only when the checkout actually is a linked worktree. */}
        {isLinkedWorktree && branch && workingDirectory && agentId && (
          <WorktreeSwitcher
            agentId={agentId}
            currentBranch={branch}
            detached={detached}
            deviceId={deviceId}
            isGithub={isGithub}
            path={workingDirectory}
            placement={'bottomLeft'}
            sourcePath={sourcePath ?? workingDirectory}
            worktrees={worktrees}
            onWorktreesChange={mutateWorktrees}
          >
            <OverviewRow
              interactive
              icon={GitForkIcon}
              title={workingDirectory}
              trailing={<Chevron />}
              value={pathBasename(workingDirectory)}
            />
          </WorktreeSwitcher>
        )}

        {/* Changes: the ±N numbers are the value — no sentence about them. */}
        <OverviewRow
          icon={ClipboardListIcon}
          value={t('workingPanel.overview.changes')}
          trailing={
            changeStats.files > 0 ? (
              <>
                <span className={styles.changeAdditions}>+{changeStats.additions}</span>
                <span className={styles.changeDeletions}>−{changeStats.deletions}</span>
              </>
            ) : (
              t('workingPanel.overview.changes.none')
            )
          }
          onClick={() => onOpenTab('review')}
        />

        {/* Sync: the row is the action, one action per row. */}
        {showBehind && (
          <OverviewRow
            icon={ArrowDownIcon}
            iconColor={cssVar.colorError}
            trailing={pulling ? <RingLoadingIcon size={12} /> : aheadBehind!.behind}
            value={t('workingPanel.overview.sync.pull')}
            onClick={syncBusy ? undefined : handlePull}
          />
        )}
        {showAhead && (
          <OverviewRow
            icon={ArrowUpIcon}
            iconColor={cssVar.colorInfo}
            trailing={pushing ? <RingLoadingIcon size={12} /> : aheadBehind!.ahead}
            value={t('workingPanel.overview.sync.push')}
            onClick={syncBusy ? undefined : handlePush}
          />
        )}

        {/* Linked PR with its CI rollup as trailing status — passing is the
            steady state, so only failure / pending earn a text label. */}
        {pullRequest && prVisual && ci && (
          <Tooltip title={`#${pullRequest.number} ${pullRequest.title}`}>
            <div>
              <OverviewRow
                icon={prVisual.icon}
                iconColor={prVisual.color}
                value={`#${pullRequest.number} ${pullRequest.title}`}
                trailing={
                  <>
                    <Icon icon={ci.icon} size={14} style={{ color: ci.color }} />
                    {shouldShowCiLabel(ciStatus)
                      ? t(
                          `workingPanel.overview.ci.${ciStatus as 'failure' | 'pending'}` as 'workingPanel.overview.ci.failure',
                        )
                      : null}
                  </>
                }
                onClick={
                  pullRequest.url
                    ? () => void electronSystemService.openExternalLink(pullRequest.url)
                    : undefined
                }
              />
            </div>
          </Tooltip>
        )}
      </>
    );

    return (
      <Flexbox className={styles.body} gap={10}>
        {environmentAvailable && (
          <Flexbox>
            <OverviewRow
              icon={workingDirectory ? FolderGit2Icon : LaptopIcon}
              title={workingDirectory}
              value={directoryName || t('workingPanel.overview.workspace.empty')}
              trailing={
                workingDirectory
                  ? t(
                      deviceId
                        ? 'workingPanel.overview.execution.device'
                        : 'workingPanel.overview.execution.local',
                    )
                  : undefined
              }
              onClick={workingDirectory ? () => onOpenTab('files') : undefined}
            />

            {repoType && workingDirectory && isGitLoading ? (
              <div className={styles.skeleton}>
                <Skeleton.Text rows={2} />
              </div>
            ) : gitError ? (
              // A failed probe is one row, not a panel-bending error block.
              <OverviewRow
                danger
                icon={GitBranchIcon}
                iconColor={cssVar.colorError}
                value={t('workingPanel.overview.environmentError')}
                trailing={
                  <ActionIcon
                    icon={RefreshCwIcon}
                    size={'small'}
                    title={tCommon('retry')}
                    onClick={() => void refreshGit()}
                  />
                }
              />
            ) : repoType && workingDirectory ? (
              gitRows
            ) : null}
          </Flexbox>
        )}

        <ProgressSection />

        {visibleWorks.length > 0 && (
          <Flexbox>
            <Flexbox
              horizontal
              align={'center'}
              className={styles.sectionHeader}
              justify={'space-between'}
            >
              <span className={styles.sectionTitle}>{t('workingPanel.overview.outputs')}</span>
              <Button size={'small'} type={'text'} onClick={() => onOpenTab('works')}>
                {t('workingPanel.overview.viewAll')}
              </Button>
            </Flexbox>
            {visibleWorks.map((work) => (
              <WorkSummaryCard item={work} key={work.id} variant={'inline'} />
            ))}
          </Flexbox>
        )}

        {/* Resource entries: kept, but demoted — same row grammar, lower weight. */}
        <Flexbox>
          {environmentAvailable && <div className={styles.divider} />}
          <Flexbox
            horizontal
            align={'center'}
            className={styles.weakRow}
            gap={10}
            role={'button'}
            onClick={() => onOpenTab('skills')}
          >
            <Icon className={styles.icon} icon={SkillsIcon} size={14} />
            <span className={styles.weakLabel}>{t('workingPanel.resources.filter.skills')}</span>
          </Flexbox>
          {!isHetero && (
            <Flexbox
              horizontal
              align={'center'}
              className={styles.weakRow}
              gap={10}
              role={'button'}
              onClick={() => onOpenTab('documents')}
            >
              <Icon className={styles.icon} icon={FileTextIcon} size={14} />
              <span className={styles.weakLabel}>
                {t('workingPanel.resources.filter.documents')}
              </span>
            </Flexbox>
          )}
        </Flexbox>

        {!topicId && visibleWorks.length === 0 && !workingDirectory && (
          <Empty
            description={t('workingPanel.overview.empty')}
            icon={BoxesIcon}
            title={t('workingPanel.overview.emptyTitle')}
          />
        )}
      </Flexbox>
    );
  },
);

Overview.displayName = 'WorkingSidebarOverview';

export default Overview;
