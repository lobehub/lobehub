'use client';

import { Block, Empty, Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Segmented, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LayoutGridIcon, ListIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import GoalSkeleton, { GoalListRowsSkeleton } from '@/components/Skeleton/Goal';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { GoalListFilter } from '@/store/goal';
import { filterGoalsByStatus, useGoalStore } from '@/store/goal';

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
  // Branch off the SWR response, not the store: the store sync (even via the
  // sync wrapper) lands an effect after first paint, and a cache hit — which
  // never fires a network callback — would render one empty-state frame in
  // between. `data?.goals` keeps the settled-empty and hydrated shapes aligned.
  const { data, error, isLoading } = useFetchGoals(agentId, projectId);
  const goals = useMemo(() => data?.goals ?? [], [data]);
  // The active tab reads its own statuses from the server. `all` shares the
  // window read's cache entry, so the page only pays for an extra request once
  // the user opens a narrow tab.
  const tabSWR = useFetchGoals(agentId, projectId, filter);
  // `delivered` is a whole-set count, not a count of the page the list happens
  // to hold: read the review set's own total so the header can never disagree
  // with what the Needs-review tab shows once a goal sits past the list's page.
  const reviewSWR = useFetchGoals(agentId, projectId, 'review');
  const summary = useMemo(() => {
    const total = data?.total ?? goals.length;
    const delivered =
      reviewSWR.data?.total ?? goals.filter(({ goal }) => goal.status === 'review').length;

    return { delivered, pursuing: total - delivered, total };
  }, [data, goals, reviewSWR.data]);
  // A page of the newest goals cannot prove a tab empty, so until the tab's own
  // read answers the list holds its shape instead of claiming an outcome.
  const isTabPending = filter !== 'all' && tabSWR.data === undefined;
  const filteredGoals = useMemo(
    () => (filter === 'all' ? goals : (tabSWR.data?.goals ?? filterGoalsByStatus(goals, filter))),
    [filter, goals, tabSWR.data],
  );
  const isFilterEmpty = !isTabPending && filteredGoals.length === 0;
  const visibleGoalCount = filteredGoals.length;
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
        flex={1}
        gap={16}
        paddingBlock={16}
        wrapperStyle={{ flex: 1, overflowY: 'auto' }}
      >
        {isLoading && data === undefined ? (
          <GoalSkeleton chrome={'body'} />
        ) : error ? (
          <Block padding={32} variant={'outlined'}>
            <Flexbox align={'center'} gap={12}>
              <Text weight={600}>{t('goalList.loadError')}</Text>
              <Text fontSize={13} type={'secondary'}>
                {t('goalList.loadErrorDescription')}
              </Text>
              <Button icon={RefreshCwIcon} onClick={() => void refreshGoals(scopeId)}>
                {t('goalList.retry')}
              </Button>
            </Flexbox>
          </Block>
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
                      {summary.pursuing}
                    </Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('goalPage.metrics.pursuing')}
                    </Text>
                  </Flexbox>
                  <Flexbox className={styles.metric} gap={2}>
                    <Text fontSize={20} weight={600}>
                      {summary.delivered}
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
                {isTabPending ? (
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
