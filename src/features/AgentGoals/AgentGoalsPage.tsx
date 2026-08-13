'use client';

import { ActionIcon, Block, Empty, Flexbox, Text } from '@lobehub/ui';
import { Button, Segmented } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LayoutGridIcon, ListIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { goalSelectors, useGoalStore } from '@/store/goal';
import { useVerifyStore } from '@/store/verify';

import { createGoalModal } from './CreateGoalModal';
import { GoalCardItem } from './GoalCardItem';
import GoalEmptyState from './GoalEmptyState';
import type { GoalExampleSeed } from './goalExamples';
import { GoalListItem } from './GoalListItem';
import { getGoalPresentation } from './goalPresentation';
import { shouldShowGoal } from './goalViewModel';

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
  agentId: string;
}

const AgentGoalsPage = memo<AgentGoalsPageProps>(({ agentId }) => {
  const { t } = useTranslation('chat');
  const useFetchGoals = useGoalStore((s) => s.useFetchGoals);
  const refreshGoals = useGoalStore((s) => s.refreshGoals);
  const goals = useGoalStore(goalSelectors.goalList(agentId));
  const isInitialized = useGoalStore(goalSelectors.isGoalListInitialized(agentId));
  const filter = useGoalStore((s) => s.goalListFilter);
  const viewMode = useGoalStore((s) => s.goalViewMode);
  const visibleLimit = useGoalStore((s) => s.goalListVisibleLimit);
  const setFilter = useGoalStore((s) => s.setGoalListFilter);
  const setViewMode = useGoalStore((s) => s.setGoalViewMode);
  const loadMoreGoals = useGoalStore((s) => s.loadMoreGoals);
  const acceptanceBySubjectMap = useVerifyStore((s) => s.acceptanceBySubjectMap);
  const acceptanceBundleMap = useVerifyStore((s) => s.acceptanceBundleMap);
  const { error, isLoading } = useFetchGoals(agentId);
  const summary = useMemo(() => {
    const delivered = goals.filter((goal) => goal.status === 'completed').length;

    return { delivered, pursuing: goals.length - delivered, total: goals.length };
  }, [goals]);
  const filteredGoals = useMemo(() => {
    if (filter === 'all') return goals;

    return goals.filter((goal) => {
      const acceptance = acceptanceBySubjectMap[`task:${goal.id}`];
      const bundle = acceptance ? acceptanceBundleMap[acceptance.id] : undefined;
      const config = goal.config as { goal?: { maxIterations?: number | null } } | null;
      const presentation = getGoalPresentation({
        acceptanceStatus: bundle?.acceptance.status,
        checks: bundle?.checks,
        maxRounds: config?.goal?.maxIterations,
        rounds: goal.totalTopics ?? 0,
        taskStatus: goal.status,
      });

      return shouldShowGoal(presentation.statusKey, 'active');
    });
  }, [acceptanceBundleMap, acceptanceBySubjectMap, filter, goals]);
  const visibleGoalCount = filteredGoals.length;
  const GoalItem = viewMode === 'list' ? GoalListItem : GoalCardItem;
  const openCreateGoal = (seed?: GoalExampleSeed) => {
    createGoalModal({
      agentId,
      initialRequirement: seed?.requirement,
      initialRoundBudget: seed?.roundBudget,
      initialTitle: seed?.title,
      onCreated: () => void refreshGoals(agentId),
    });
  };

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={<AgentBreadcrumb agentId={agentId} title={t('goalList.title')} />}
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
        {isLoading && !isInitialized ? (
          <Flexbox align={'center'} flex={1} justify={'center'}>
            <NeuralNetworkLoading />
          </Flexbox>
        ) : error ? (
          <Block padding={32} variant={'outlined'}>
            <Flexbox align={'center'} gap={12}>
              <Text weight={600}>{t('goalList.loadError')}</Text>
              <Text fontSize={13} type={'secondary'}>
                {t('goalList.loadErrorDescription')}
              </Text>
              <Button
                icon={RefreshCwIcon}
                size={'small'}
                onClick={() => void refreshGoals(agentId)}
              >
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
                        label: t('goalPage.filter.open'),
                        value: 'active',
                      },
                      {
                        label: t('goalPage.filter.all'),
                        value: 'all',
                      },
                    ]}
                    onChange={(value) => setFilter(value as 'active' | 'all')}
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
                {filteredGoals.length === 0 ? (
                  <Block padding={32} variant={'outlined'}>
                    <Empty
                      description={t('goalPage.filteredEmptyDescription')}
                      title={t('goalPage.filteredEmptyTitle')}
                    />
                  </Block>
                ) : (
                  filteredGoals
                    .slice(0, visibleLimit)
                    .map((goal) => (
                      <GoalItem hideAchieved={filter === 'active'} key={goal.id} task={goal} />
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
