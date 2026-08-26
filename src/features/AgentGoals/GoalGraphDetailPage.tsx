'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import GoalDetailSkeleton from '@/components/Skeleton/GoalDetail';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { goalSelectors, useGoalStore } from '@/store/goal';

import { getGoalPresentation } from './goalPresentation';
import GoalStatusGlyph from './GoalStatusGlyph';
import ProcessControl from './ProcessControl';

/**
 * Detail page for a Goal Graph goal — one created through `goal.create` rather
 * than the `/goal` task flow, so it has no carrier task to hang a task-detail
 * page on. The route accepts either form: the task-carried page falls back here
 * when the identifier resolves to no task.
 */

const styles = createStaticStyles(({ css }) => ({
  header: css`
    padding-block: 8px 4px;
  `,
  metric: css`
    min-width: 112px;

    & + & {
      padding-inline-start: 18px;
      border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
}));

interface GoalGraphDetailPageProps {
  agentId: string;
  goalId: string;
}

const GoalGraphDetailPage = memo<GoalGraphDetailPageProps>(({ agentId, goalId }) => {
  const { t } = useTranslation('chat');
  const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
  const { error, isLoading, mutate } = useFetchGoalGraph(goalId);
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));

  if (error && !snapshot) return <AsyncError error={error} variant={'page'} onRetry={mutate} />;
  if (!snapshot)
    return isLoading ? (
      <GoalDetailSkeleton />
    ) : (
      <NotFound desc={t('goalDetail.notFoundDescription')} title={t('goalDetail.notFoundTitle')} />
    );

  const { goal, nodes } = snapshot;
  const statusKey = getGoalPresentation({ goalStatus: goal.status, rounds: 0 }).statusKey;
  const tasks = nodes.filter((node) => node.kind === 'work').length;
  const findings = nodes.filter((node) => node.kind === 'finding').length;

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={
          <AgentBreadcrumb
            agentId={agentId}
            extraItems={[goal.title]}
            title={t('goalList.title')}
          />
        }
      />
      <Flexbox flex={1} style={{ overflowY: 'auto' }}>
        <WideScreenContainer gap={20} paddingBlock={16}>
          <Flexbox className={styles.header} gap={8}>
            <Text as={'h1'} fontSize={22} weight={600}>
              {goal.title}
            </Text>
            <Flexbox horizontal gap={18} wrap={'wrap'}>
              <Flexbox className={styles.metric} gap={2}>
                <Flexbox horizontal align={'center'} gap={7}>
                  <GoalStatusGlyph size={16} status={goal.status} />
                  <Text fontSize={16} weight={600}>
                    {t(statusKey as 'goalList.status.running')}
                  </Text>
                </Flexbox>
                <Text fontSize={12} type={'secondary'}>
                  {t('goalProcess.metrics.status')}
                </Text>
              </Flexbox>
              <Flexbox className={styles.metric} gap={2}>
                <Text fontSize={18} weight={600}>
                  {tasks}
                </Text>
                <Text fontSize={12} type={'secondary'}>
                  {t('goalProcess.metrics.tasks')}
                </Text>
              </Flexbox>
              <Flexbox className={styles.metric} gap={2}>
                <Text fontSize={18} weight={600}>
                  {findings}
                </Text>
                <Text fontSize={12} type={'secondary'}>
                  {t('goalProcess.metrics.findings')}
                </Text>
              </Flexbox>
            </Flexbox>
            {goal.requirement && (
              <Flexbox gap={4} paddingBlock={'8px 0'}>
                <Text fontSize={12} type={'secondary'} weight={500}>
                  {t('goalProcess.requirement')}
                </Text>
                <Text fontSize={14} style={{ lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                  {goal.requirement}
                </Text>
              </Flexbox>
            )}
          </Flexbox>

          <ProcessControl goalId={goalId} />
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

GoalGraphDetailPage.displayName = 'GoalGraphDetailPage';

export default GoalGraphDetailPage;
