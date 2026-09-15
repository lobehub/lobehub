import { Flexbox } from '@lobehub/ui';
import { Accordion, ActionIcon, Skeleton, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Maximize2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import GoalHeaderMetrics from '@/features/AgentGoals/GoalHeaderMetrics';
import Activity from '@/features/AgentGoals/ProcessControl/Activity';
import Deliverables from '@/features/AgentGoals/ProcessControl/Deliverables';
import Findings from '@/features/AgentGoals/ProcessControl/Findings';
import Frontier from '@/features/AgentGoals/ProcessControl/Frontier';
import { buildGoalGraphView } from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import Graph from '@/features/AgentGoals/ProcessControl/Graph';
import {
  isGoalClosed,
  isGoalPlanning,
  useFrontierActions,
  useGoalNodeSelect,
} from '@/features/AgentGoals/ProcessControl/useGoalProcessActions';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';

import { useOpenGoalPage } from './useOpenGoalPage';

/**
 * The whole goal beside the conversation that planned it: header metrics, what
 * can move now, the exploration map, then what it produced, concluded and did.
 * Fetches the graph itself (polling while the server advances it), so it works
 * on any surface that hosts the Portal. Every click drills further down the same
 * view stack — node → task → topic — and Back returns here.
 *
 * The map runs inline only: its fullscreen overlay carries a second Portal
 * panel, which cannot nest inside this one, so the expand action leaves for the
 * goal page instead.
 */

const styles = createStaticStyles(({ css }) => ({
  section: css`
    padding-block: 8px;
  `,
}));

const Body = memo(() => {
  const { t } = useTranslation('chat');
  const { allowed: canEdit } = usePermission('create_content');
  const goalId = useChatStore(chatPortalSelectors.goalPortalId);
  const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
  const { error, isLoading, mutate } = useFetchGoalGraph(goalId);
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));
  const graph = useMemo(() => (snapshot ? buildGoalGraphView(snapshot) : undefined), [snapshot]);
  const select = useGoalNodeSelect(goalId ?? '', graph);
  const actions = useFrontierActions(goalId ?? '');
  const openGoalPage = useOpenGoalPage(goalId);

  if (!goalId) return null;

  if (error && !snapshot)
    return (
      <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflowY: 'auto' }}>
        <AsyncError error={error} variant={'page'} onRetry={() => void mutate()} />
      </Flexbox>
    );

  if (!snapshot || !graph)
    return isLoading ? (
      <Flexbox gap={16} padding={16}>
        <Skeleton height={56} radius={8} />
        <Skeleton height={160} radius={8} />
        <Skeleton height={320} radius={8} />
      </Flexbox>
    ) : (
      <NotFound desc={t('goalDetail.notFoundDescription')} title={t('goalDetail.notFoundTitle')} />
    );

  const hasGraph = graph.nodes.length > 0;
  const planning = isGoalPlanning(graph);

  return (
    <Flexbox flex={1} gap={20} padding={16} style={{ minHeight: 0, overflowY: 'auto' }}>
      <GoalHeaderMetrics goalId={goalId} />
      {hasGraph && (
        <>
          <Frontier
            actions={actions}
            canEdit={canEdit && !isGoalClosed(graph)}
            graph={graph}
            planning={planning}
            onSelect={select}
          />
          <Graph
            graph={graph}
            key={goalId}
            planning={planning}
            extra={
              openGoalPage && (
                <ActionIcon
                  aria-label={t('goalProcess.portal.openPage')}
                  icon={Maximize2}
                  size={'small'}
                  title={t('goalProcess.portal.openPage')}
                  onClick={openGoalPage}
                />
              )
            }
            onSelect={select}
          />
          <Accordion
            defaultValue={['deliverables', 'findings', 'activity']}
            gap={0}
            indicatorPlacement="inline"
            styles={{ header: { paddingBlock: 6, paddingInline: 0 } }}
            items={[
              {
                children: (
                  <Flexbox className={styles.section}>
                    <Deliverables graph={graph} />
                  </Flexbox>
                ),
                key: 'deliverables',
                title: (
                  <Flexbox horizontal align={'center'} gap={8}>
                    <Text fontSize={14} weight={600}>
                      {t('goalProcess.deliverables.title')}
                    </Text>
                    {graph.artifacts.length > 0 && (
                      <Tag size={'small'}>{graph.artifacts.length}</Tag>
                    )}
                  </Flexbox>
                ),
              },
              {
                children: (
                  <Flexbox className={styles.section}>
                    <Findings graph={graph} onSelect={select} />
                  </Flexbox>
                ),
                key: 'findings',
                title: (
                  <Flexbox horizontal align={'center'} gap={8}>
                    <Text fontSize={14} weight={600}>
                      {t('goalProcess.findings.title')}
                    </Text>
                    {graph.findings.length > 0 && <Tag size={'small'}>{graph.findings.length}</Tag>}
                  </Flexbox>
                ),
              },
              {
                children: (
                  <Flexbox className={styles.section}>
                    <Activity graph={graph} onSelect={select} />
                  </Flexbox>
                ),
                key: 'activity',
                title: (
                  <Text fontSize={14} weight={600}>
                    {t('goalProcess.activity.title')}
                  </Text>
                ),
              },
            ]}
          />
        </>
      )}
    </Flexbox>
  );
});

Body.displayName = 'GoalPortalBody';

export default Body;
