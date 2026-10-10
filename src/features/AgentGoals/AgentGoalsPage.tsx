'use client';

import { Block, Empty, Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Segmented, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from '@lobehub/ui';
import { LayoutGridIcon, ListIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import GoalSkeleton, { GoalListRowsSkeleton } from '@/components/Skeleton/Goal';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { GoalListFilter } from '@/store/goal';
import { goalSelectors, useGoalStore } from '@/store/goal';
import { goalListKey } from '@/store/goal/projection';

import { createGoalModal } from './CreateGoalModal';
import { GoalCardItem } from './GoalCardItem';
import GoalEmptyState from './GoalEmptyState';
import type { GoalExampleSeed } from './goalExamples';
import { GoalListItem } from './GoalListItem';

const styles = createStaticStyles(({ css }) => ({
  countBadge: css`
    padding-block: 1px;
    padding-inline: 7px;
    border-radius: 99px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  overview: css`
    padding-block: 6px 18px;
  `,
  list: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;

    @media (width <= 900px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  listRows: css`
    display: flex;
    flex-direction: column;
    border-block: 1px solid ${cssVar.colorBorderSecondary};
  `,
  metric: css`
    min-width: 88px;
    padding-inline-start: 16px;
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};

    &:first-child {
      padding-inline-start: 0;
      border-inline-start: 0;
    }
  `,
}));

/**
 * The list failed to load — the page's own read, or the selected tab's. Both
 * carry the same retry, which revalidates every tab's entry at once.
 */
const GoalLoadError = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useTranslation('chat');

  return (
    <Block padding={32} variant={'outlined'}>
      <Flexbox align={'center'} gap={12}>
        <Text weight={600}>{t('goalList.loadError')}</Text>
        <Text fontSize={13} type={'secondary'}>
          {t('goalList.loadErrorDescription')}
        </Text>
        <Button icon={RefreshCwIcon} onClick={onRetry}>
          {t('goalList.retry')}
        </Button>
      </Flexbox>
    </Block>
  );
};

interface AgentGoalsPageProps {
  agentId?: string;
  projectId?: string;
}

const AgentGoalsPage = memo<AgentGoalsPageProps>(({ agentId, projectId }) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const scopeId = projectId ? `project:${projectId}` : agentId!;
  const useFetchGoals = useGoalStore((s) => s.useFetchGoals);
  const refreshGoals = useGoalStore((s) => s.refreshGoals);
  const filter = useGoalStore((s) => s.goalListFilter);
  const viewMode = useGoalStore((s) => s.goalViewMode);
  const visibleLimit = useGoalStore((s) => s.goalListVisibleLimit);
  const setFilter = useGoalStore((s) => s.setGoalListFilter);
  const setViewMode = useGoalStore((s) => s.setGoalViewMode);
  const loadMoreGoals = useGoalStore((s) => s.loadMoreGoals);
  // The rows live in the replica view; the hook only orchestrates the fetch, so
  // a revisit paints the persisted projection on the first frame instead of an
  // empty-state frame while the sync lands.
  const { error, isLoading } = useFetchGoals(agentId, projectId);
  // The active tab reads its own statuses from the server. `all` shares the
  // window read's entry, so the page only pays for an extra request once the
  // user opens a narrow tab.
  const tabSync = useFetchGoals(agentId, projectId, filter);
  // `delivered` is a whole-set count, not a count of the page the list happens
  // to hold: read the review set's own total so the header can never disagree
  // with what the Needs-review tab shows once a goal sits past the list's page.
  // The read has to run whichever tab is active, since the header shows it
  // regardless — the rows themselves come from the view below.
  useFetchGoals(agentId, projectId, 'review');
  const listView = useGoalStore(goalSelectors.goalListView(scopeId));
  const tabView = useGoalStore(
    goalSelectors.goalListView(
      filter === 'all' ? scopeId : goalListKey({ agentId, filter, projectId }),
    ),
  );
  const reviewView = useGoalStore(
    goalSelectors.goalListView(goalListKey({ agentId, filter: 'review', projectId })),
  );
  const goals = useMemo(() => listView?.goals ?? [], [listView]);
  const summary = useMemo(() => {
    const total = listView?.total ?? goals.length;
    // An aggregate that has not answered is unknown, not zero. Falling back to
    // the review goals visible in the list's page would understate it for
    // exactly the accounts this page reads past one page, and present that
    // partial count as the delivered total.
    const delivered = reviewView?.total;

    return {
      delivered,
      pursuing: delivered === undefined ? undefined : total - delivered,
      total,
    };
  }, [goals.length, listView?.total, reviewView?.total]);
  // A page of the newest goals cannot prove a tab empty, and neither can a read
  // that failed: hold the list's shape while the tab's own read is in flight,
  // and surface its failure rather than spinning on it.
  const isTabUnresolved = filter !== 'all' && tabView === undefined;
  const isTabPending = isTabUnresolved && !tabSync.error;
  const isTabError = isTabUnresolved && Boolean(tabSync.error);
  // The rows are the tab's own read, with no client-side fallback: a page of the
  // newest goals cannot stand in for the tab's answer, and presenting it as if
  // it could is what let a tab claim an outcome it had no way to know.
  const filteredGoals = useMemo(
    () => (filter === 'all' ? goals : (tabView?.goals ?? [])),
    [filter, goals, tabView],
  );
  const isFilterEmpty = !isTabUnresolved && filteredGoals.length === 0;
  // The tab's count is the server's answer for that tab. Until it arrives — or
  // when it failed — the list's page cannot stand in for it either.
  const visibleGoalCount = isTabUnresolved ? '—' : filteredGoals.length;
  const GoalItem = viewMode === 'list' ? GoalListItem : GoalCardItem;
  const openCreateGoal = (seed?: GoalExampleSeed) => {
    createGoalModal({
      agentId,
      initialRequirement: seed?.requirement,
      initialRoundBudget: seed?.roundBudget,
      initialTitle: seed?.title,
      projectId,
      // Land the user inside the goal right away: the detail page polls while
      // the goal is still planning, so the exploration graph grows in place
      // instead of the modal blocking on it.
      onCreated: (goal) => {
        void refreshGoals(scopeId);
        const ownerId = goal.agentId ?? agentId;
        navigate(ownerId ? `/agent/${ownerId}/goal/${goal.goalId}` : `/goal/${goal.goalId}`);
      },
    });
  };

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={
          agentId ? (
            <AgentBreadcrumb agentId={agentId} title={t('goalList.title')} />
          ) : (
            <Text weight={600}>{t('goalList.title')}</Text>
          )
        }
        right={
          <Button icon={PlusIcon} size={'small'} type={'fill'} onClick={() => openCreateGoal()}>
            {t('goalPage.create')}
          </Button>
        }
      />
      <WideScreenContainer
        fullWidth
        flex={1}
        gap={16}
        paddingBlock={16}
        paddingInline={16}
        wrapperStyle={{ flex: 1, overflowY: 'auto' }}
      >
        {isLoading ? (
          <GoalSkeleton chrome={'body'} />
        ) : error && listView === undefined ? (
          // Only a read that left nothing to show becomes the page: a failed
          // revalidation keeps the hydrated rows on screen (the same guard the
          // home rail, the goal portal and the detail page use), so a network
          // blip no longer hides goals the user already has locally.
          <GoalLoadError onRetry={() => void refreshGoals(scopeId)} />
        ) : goals.length === 0 ? (
          <GoalEmptyState onCreate={openCreateGoal} />
        ) : (
          <>
            <Flexbox className={styles.overview}>
              <Flexbox horizontal align={'center'} gap={20} justify={'space-between'} wrap={'wrap'}>
                <Flexbox gap={3}>
                  <Text fontSize={20} weight={600}>
                    {t('goalPage.title')}
                  </Text>
                  <Text type={'secondary'}>{t('goalPage.description')}</Text>
                </Flexbox>
                <Flexbox horizontal gap={20}>
                  <Flexbox className={styles.metric} gap={2}>
                    <Text fontSize={20} weight={600}>
                      {summary.total}
                    </Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('goalPage.metrics.total')}
                    </Text>
                  </Flexbox>
                  <Flexbox className={styles.metric} gap={2}>
                    <Text fontSize={20} weight={600}>
                      {summary.pursuing ?? '—'}
                    </Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('goalPage.metrics.pursuing')}
                    </Text>
                  </Flexbox>
                  <Flexbox className={styles.metric} gap={2}>
                    <Text fontSize={20} weight={600}>
                      {summary.delivered ?? '—'}
                    </Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('goalPage.metrics.delivered')}
                    </Text>
                  </Flexbox>
                </Flexbox>
              </Flexbox>
            </Flexbox>
            <Flexbox gap={10}>
              <Flexbox horizontal align={'center'} justify={'space-between'}>
                <Flexbox horizontal align={'center'} gap={8}>
                  <Text fontSize={16} weight={600}>
                    {t('goalPage.listTitle')}
                  </Text>
                  <span className={styles.countBadge}>{visibleGoalCount}</span>
                </Flexbox>
                <Flexbox horizontal align={'center'} gap={8}>
                  <Segmented
                    size={'small'}
                    value={filter}
                    options={[
                      {
                        label: t('goalPage.filter.all'),
                        value: 'all',
                      },
                      {
                        label: t('goalPage.filter.review'),
                        value: 'review',
                      },
                      {
                        label: t('goalPage.filter.running'),
                        value: 'running',
                      },
                      {
                        label: t('goalPage.filter.achieved'),
                        value: 'achieved',
                      },
                    ]}
                    onChange={(value) => setFilter(value as GoalListFilter)}
                  />
                  <ActionIcon
                    icon={ListIcon}
                    size={'small'}
                    style={{ alignSelf: 'center' }}
                    title={t('goalPage.view.list')}
                    variant={viewMode === 'list' ? 'filled' : 'borderless'}
                    onClick={() => setViewMode('list')}
                  />
                  <ActionIcon
                    icon={LayoutGridIcon}
                    size={'small'}
                    style={{ alignSelf: 'center' }}
                    title={t('goalPage.view.card')}
                    variant={viewMode === 'card' ? 'filled' : 'borderless'}
                    onClick={() => setViewMode('card')}
                  />
                </Flexbox>
              </Flexbox>
              <div className={viewMode === 'card' ? styles.list : styles.listRows}>
                {isTabError ? (
                  <GoalLoadError onRetry={() => void refreshGoals(scopeId)} />
                ) : isTabPending ? (
                  <GoalListRowsSkeleton />
                ) : isFilterEmpty ? (
                  <Block padding={32} variant={'outlined'}>
                    <Empty
                      description={t('goalPage.filteredEmptyDescription')}
                      title={t('goalPage.filteredEmptyTitle')}
                    />
                  </Block>
                ) : (
                  filteredGoals
                    .slice(0, visibleLimit)
                    .map((item) => (
                      <GoalItem goal={item} key={item.goal.id} projectId={projectId} />
                    ))
                )}
              </div>
              {visibleLimit < filteredGoals.length && (
                <Flexbox align={'center'} paddingBlock={8}>
                  <Button size={'small'} onClick={loadMoreGoals}>
                    {t('goalPage.loadMore')}
                  </Button>
                </Flexbox>
              )}
            </Flexbox>
          </>
        )}
      </WideScreenContainer>
    </Flexbox>
  );
});

AgentGoalsPage.displayName = 'AgentGoalsPage';

export default AgentGoalsPage;
