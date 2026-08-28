'use client';

import { Accordion, AccordionItem, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Button, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Pause, Play, StepForward } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { goalService } from '@/services/goal';
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
  const [advancing, setAdvancing] = useState(false);

  const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
  const decideGoal = useGoalStore((s) => s.decideGoal);
  const pauseGoal = useGoalStore((s) => s.pauseGoal);
  const resumeGoal = useGoalStore((s) => s.resumeGoal);
  const advanceGoalNow = useGoalStore((s) => s.advanceGoal);
  const refreshGoalGraph = useGoalStore((s) => s.refreshGoalGraph);
  useFetchGoalGraph(goalId);
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));

  const graph = useMemo(() => (snapshot ? buildGoalGraphView(snapshot) : undefined), [snapshot]);

  // One press hands the goal to the server's coordinator, which runs it as far
  // as it can go in one call and then keeps going on its own as each Work Task
  // settles. A single coordinator step is an implementation unit — a press that
  // only ticked once usually looked like it did nothing, because the very next
  // step is what dispatches the task.
  const advance = useCallback(async () => {
    if (advancing) return;
    setAdvancing(true);
    try {
      const result = await advanceGoalNow(goalId);
      toast.info(result.message);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setAdvancing(false);
    }
  }, [advancing, advanceGoalNow, goalId]);

  const actions: FrontierActions = useMemo(
    () => ({
      addTask: async (title: string) => {
        await goalService.addNode({ id: goalId, kind: 'work', title });
        await refreshGoalGraph(goalId);
      },
      advance: () => void advance(),
      decide: (decisionId, optionId, resolution) =>
        void decideGoal(goalId, { decisionId, optionId, resolution }),
    }),
    [advance, decideGoal, goalId, refreshGoalGraph],
  );

  // Task-carried goals share the `goals` table but never grow a graph. Nothing
  // to control here, so the page keeps its original shape.
  if (!graph || graph.nodes.length === 0) return null;

  const paused = graph.goal.status === 'paused';
  // A closed goal cannot move: the coordinator returns immediately for these,
  // so Advance would report nothing happened and a Work added here would sit
  // `proposed` forever. Stop offering actions that cannot land.
  const closed = ['achieved', 'canceled', 'failed'].includes(graph.goal.status);
  const canAct = canEdit && !closed;

  return (
    <Flexbox gap={20}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8}>
          {canAct && (
            <>
              <Tooltip title={t('goalProcess.advance.tooltip')}>
                <Button
                  icon={<Icon icon={StepForward} />}
                  loading={advancing}
                  size={'small'}
                  type={'primary'}
                  onClick={advance}
                >
                  {advancing ? t('goalProcess.advance.running') : t('goalProcess.advance.label')}
                </Button>
              </Tooltip>
              <Button
                icon={<Icon icon={paused ? Play : Pause} />}
                size={'small'}
                onClick={() => void (paused ? resumeGoal(goalId) : pauseGoal(goalId))}
              >
                {paused ? t('goalProcess.resume') : t('goalProcess.pause')}
              </Button>
            </>
          )}
          {paused && (
            <Text fontSize={12} type={'secondary'}>
              {t('goalProcess.paused')}
            </Text>
          )}
        </Flexbox>

        <Frontier actions={actions} canEdit={canAct} graph={graph} onSelect={setSelectedId} />
      </Flexbox>

      <Graph graph={graph} selectedId={selectedId} onSelect={setSelectedId} />

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
            <Findings graph={graph} onSelect={setSelectedId} />
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
            <Activity graph={graph} onSelect={setSelectedId} />
          </Flexbox>
        </AccordionItem>
      </Accordion>
    </Flexbox>
  );
});

ProcessControl.displayName = 'GoalProcessControl';

export default ProcessControl;
