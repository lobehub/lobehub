'use client';

import { Empty, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Button, Skeleton, toast } from '@lobehub/ui/base-ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoxesIcon,
  ClipboardListIcon,
  FilesIcon,
  FileTextIcon,
  GitBranchIcon,
  GitForkIcon,
  LaptopIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
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
import OverviewHeader from './OverviewHeader';
import { ChevronRight, OverviewRow, PickerGlyph, rowStyles } from './OverviewRow';
import { sectionStyles } from './sectionStyles';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
  `,
  emptyWorkspace: css`
    padding-block: 28px 30px;
    padding-inline: 20px;
  `,
}));

interface OverviewProps {
  active: boolean;
  agentId?: string;
  deviceId?: string;
  environmentAvailable: boolean;
  onOpenTab: (tab: string) => void;
  prAvailable?: boolean;
  repoType?: string;
  sourcePath?: string;
  workingDirectory?: string;
}

const pathBasename = (path: string) => path.replaceAll('\\', '/').split('/').findLast(Boolean);

const Overview = memo<OverviewProps>(
  ({
    active,
    agentId,
    deviceId,
    environmentAvailable,
    onOpenTab,
    prAvailable,
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
    const hasWorkspace = environmentAvailable && !!workingDirectory;

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
        trailing={!detached && agentId ? <PickerGlyph /> : undefined}
        value={
          detached ? (
            <>
              <span className={rowStyles.num}>{branch}</span>
              {t('workingPanel.overview.branch.detached')}
            </>
          ) : (
            branch
          )
        }
      />
    );

    const gitRows = (
      <>
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

        {showBehind && (
          <OverviewRow
            icon={ArrowDownIcon}
            iconColor={cssVar.colorError}
            iconSize={14}
            value={t('workingPanel.overview.sync.behind', { count: aheadBehind!.behind })}
            trailing={
              pulling ? (
                <RingLoadingIcon size={12} />
              ) : (
                <span className={rowStyles.rowAction}>{t('workingPanel.overview.sync.pull')}</span>
              )
            }
            onClick={syncBusy ? undefined : handlePull}
          />
        )}
        {showAhead && (
          <OverviewRow
            icon={ArrowUpIcon}
            iconColor={cssVar.colorInfo}
            iconSize={14}
            value={t('workingPanel.overview.sync.ahead', { count: aheadBehind!.ahead })}
            trailing={
              pushing ? (
                <RingLoadingIcon size={12} />
              ) : (
                <span className={rowStyles.rowAction}>{t('workingPanel.overview.sync.push')}</span>
              )
            }
            onClick={syncBusy ? undefined : handlePush}
          />
        )}

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
              title={sourcePath ?? workingDirectory}
              trailing={<PickerGlyph />}
              value={t('workingPanel.overview.worktree.of', {
                name: pathBasename(sourcePath ?? workingDirectory),
              })}
            />
          </WorktreeSwitcher>
        )}

        <OverviewRow
          icon={ClipboardListIcon}
          value={t('workingPanel.overview.changes')}
          trailing={
            changeStats.files > 0 ? (
              <>
                <span className={rowStyles.changeAdditions}>+{changeStats.additions}</span>
                <span className={rowStyles.changeDeletions}>−{changeStats.deletions}</span>
              </>
            ) : (
              t('workingPanel.overview.changes.none')
            )
          }
          onClick={() => onOpenTab('review')}
        />

        {pullRequest && prVisual && ci && (
          <Tooltip title={`#${pullRequest.number} ${pullRequest.title}`}>
            <div>
              <OverviewRow
                icon={prVisual.icon}
                iconColor={prVisual.color}
                trailing={
                  <span
                    className={sectionStyles.pill}
                    style={{ background: `color-mix(in srgb,  12%, transparent)`, color: ci.color }}
                  >
                    <Icon icon={ci.icon} size={12} />
                    {shouldShowCiLabel(ciStatus)
                      ? t(
                          `workingPanel.overview.ci.${ciStatus as 'failure' | 'pending'}` as 'workingPanel.overview.ci.failure',
                        )
                      : null}
                  </span>
                }
                value={
                  <>
                    <span className={rowStyles.num}>#{pullRequest.number}</span>
                    {pullRequest.title}
                  </>
                }
                onClick={
                  prAvailable
                    ? () => onOpenTab('pr')
                    : pullRequest.url
                      ? () => void electronSystemService.openExternalLink(pullRequest.url)
                      : undefined
                }
              />
            </div>
          </Tooltip>
        )}
      </>
    );

    const workspaceSection = repoType ? (
      isGitLoading ? (
        <div className={sectionStyles.skeleton}>
          <Skeleton.Text rows={3} />
        </div>
      ) : gitError ? (
        <OverviewRow
          danger
          icon={TriangleAlertIcon}
          iconColor={cssVar.colorError}
          value={t('workingPanel.overview.environmentError')}
          trailing={
            <Button
              icon={<Icon icon={RefreshCwIcon} size={12} />}
              size={'small'}
              onClick={() => void refreshGit()}
            >
              {tCommon('retry')}
            </Button>
          }
        />
      ) : (
        gitRows
      )
    ) : (
      <OverviewRow
        icon={FilesIcon}
        trailing={<ChevronRight />}
        value={t('workingPanel.overview.files')}
        onClick={() => onOpenTab('files')}
      />
    );

    return (
      <Flexbox className={styles.body}>
        {hasWorkspace && (
          <>
            <OverviewHeader
              deviceId={deviceId}
              error={!!gitError}
              name={directoryName!}
              path={workingDirectory}
              repoType={repoType}
              onClick={() => onOpenTab('files')}
            />
            <Flexbox className={sectionStyles.section}>{workspaceSection}</Flexbox>
          </>
        )}

        {environmentAvailable && !workingDirectory && (
          <Empty
            className={cx(sectionStyles.section, styles.emptyWorkspace)}
            description={t('workingPanel.overview.workspace.emptyDesc')}
            icon={LaptopIcon}
            title={t('workingPanel.overview.workspace.empty')}
          />
        )}

        <ProgressSection className={sectionStyles.section} />

        {visibleWorks.length > 0 && (
          <Flexbox className={sectionStyles.section}>
            <Flexbox
              horizontal
              align={'center'}
              className={sectionStyles.sectionHeader}
              justify={'space-between'}
            >
              <span className={sectionStyles.sectionTitle}>
                {t('workingPanel.overview.outputs')}
              </span>
              <Button
                outdent={'end'}
                size={'small'}
                type={'text'}
                onClick={() => onOpenTab('works')}
              >
                {t('workingPanel.overview.viewAll')}
              </Button>
            </Flexbox>
            {visibleWorks.map((work) => (
              <WorkSummaryCard item={work} key={work.id} variant={'inline'} />
            ))}
          </Flexbox>
        )}

        {!environmentAvailable && !topicId && visibleWorks.length === 0 && (
          <Empty
            className={sectionStyles.section}
            description={t('workingPanel.overview.empty')}
            icon={BoxesIcon}
            title={t('workingPanel.overview.emptyTitle')}
          />
        )}

        <Flexbox className={sectionStyles.section}>
          <OverviewRow
            weak
            icon={SkillsIcon}
            iconSize={15}
            trailing={<ChevronRight />}
            value={t('workingPanel.resources.filter.skills')}
            onClick={() => onOpenTab('skills')}
          />
          {!isHetero && (
            <OverviewRow
              weak
              icon={FileTextIcon}
              iconSize={15}
              trailing={<ChevronRight />}
              value={t('workingPanel.resources.filter.documents')}
              onClick={() => onOpenTab('documents')}
            />
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

Overview.displayName = 'WorkingSidebarOverview';

export default Overview;
