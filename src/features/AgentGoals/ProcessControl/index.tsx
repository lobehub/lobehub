'use client';

import { Accordion, AccordionItem, Flexbox, Icon } from '@lobehub/ui';
import { Button, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Pause, Play } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { goalService } from '@/services/goal';
import { useChatStore } from '@/store/chat';
import { goalSelectors, useGoalStore } from '@/store/goal';

import Activity from './Activity';
import Findings from './Findings';
import Frontier, { type FrontierActions } from './Frontier';
import { buildGoalGraphView } from './goalGraphViewModel';
import Graph from './Graph';

/**
 * The process-control band of the goal detail page: what can move now
 * (frontier), the map of how the goal got here, what it believes, and what it
 * has been doing. Renders only for goals that actually carry a Goal Graph —
 * a plain task-carried goal has no nodes and keeps the page it always had.
 */

const styles = createStaticStyles(({ css }) => ({
  section: css`
    padding-block: 8px;
  `,
}));

interface ProcessControlProps {
  /** The `goals` row id — not the carrier task's identifier. */
  goalId: string;
}

const ProcessControl = memo<ProcessControlProps>(({ goalId }) => {
  const { t } = useTranslation('chat');
  const { allowed: canEdit } = usePermission('create_content');
  const [selectedId, setSelectedId] = useState<string>();

  const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
  const decideGoal = useGoalStore((s) => s.decideGoal);
  const pauseGoal = useGoalStore((s) => s.pauseGoal);
  const resumeGoal = useGoalStore((s) => s.resumeGoal);
  const refreshGoalGraph = useGoalStore((s) => s.refreshGoalGraph);
  const openTaskDetail = useChatStore((s) => s.openTaskDetail);
  const openGoalNode = useChatStore((s) => s.openGoalNode);
  useFetchGoalGraph(goalId);
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));

  const graph = useMemo(() => (snapshot ? buildGoalGraphView(snapshot) : undefined), [snapshot]);

  const actions: FrontierActions = useMemo(
    () => ({
      addTask: async (title: string) => {
        await goalService.addNode({ id: goalId, kind: 'task', title });
        await refreshGoalGraph(goalId);
      },
      decide: (decisionId, optionId, resolution) =>
        void decideGoal(goalId, { decisionId, optionId, resolution }),
    }),
    [decideGoal, goalId, refreshGoalGraph],
  );

  // Every click funnels here: keep the map highlight (spatial continuity) and
  // open the drill-down — a dispatched Work goes straight to its Task detail,
  // everything else opens the node view. This is the chain the page was
  // missing: node → task → topic conversation.
  const select = useCallback(
    (nodeId: string) => {
      setSelectedId(nodeId);
      const taskId = graph?.byId[nodeId]?.node.taskId;
      if (taskId) openTaskDetail(taskId);
      else openGoalNode(goalId, nodeId);
    },
    [goalId, graph, openGoalNode, openTaskDetail],
  );

  // Task-carried goals share the `goals` table but never grow a graph. Nothing
  // to control here, so the page keeps its original shape.
  if (!graph || graph.nodes.length === 0) return null;

  const paused = graph.goal.status === 'paused';
  // A closed goal cannot move: the coordinator returns immediately for these,
  // and a Work added here would sit `proposed` forever. Stop offering actions
  // that cannot land. The goal otherwise advances entirely on its own — the
  // only legitimate human control over its pace is pause/resume.
  const closed = ['achieved', 'canceled', 'failed'].includes(graph.goal.status);
  const canAct = canEdit && !closed;

  return (
    <Flexbox gap={20}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8}>
          {canAct && (
            <Button
              icon={<Icon icon={paused ? Play : Pause} />}
              size={'small'}
              onClick={() => void (paused ? resumeGoal(goalId) : pauseGoal(goalId))}
            >
              {paused ? t('goalProcess.resume') : t('goalProcess.pause')}
            </Button>
          )}
          {paused && (
            <Text fontSize={12} type={'secondary'}>
              {t('goalProcess.paused')}
            </Text>
          )}
        </Flexbox>

        <Frontier actions={actions} canEdit={canAct} graph={graph} onSelect={select} />
      </Flexbox>

      <Graph graph={graph} selectedId={selectedId} onSelect={select} />

      <Accordion defaultExpandedKeys={['findings', 'activity']} gap={0}>
        <AccordionItem
          itemKey={'findings'}
          paddingBlock={6}
          paddingInline={0}
          title={
            <Flexbox horizontal align={'center'} gap={8}>
              <Text fontSize={14} weight={600}>
                {t('goalProcess.findings.title')}
              </Text>
              {graph.findings.length > 0 && <Tag size={'small'}>{graph.findings.length}</Tag>}
            </Flexbox>
          }
        >
          <Flexbox className={styles.section}>
            <Findings graph={graph} onSelect={select} />
          </Flexbox>
        </AccordionItem>
        <AccordionItem
          itemKey={'activity'}
          paddingBlock={6}
          paddingInline={0}
          title={
            <Flexbox horizontal align={'center'} gap={8}>
              <Text fontSize={14} weight={600}>
                {t('goalProcess.activity.title')}
              </Text>
            </Flexbox>
          }
        >
          <Flexbox className={styles.section}>
            <Activity graph={graph} onSelect={select} />
          </Flexbox>
        </AccordionItem>
      </Accordion>
    </Flexbox>
  );
});

ProcessControl.displayName = 'GoalProcessControl';

export default ProcessControl;
