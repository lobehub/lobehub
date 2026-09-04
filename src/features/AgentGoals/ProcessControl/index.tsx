'use client';

import { Accordion, AccordionItem, Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { goalService } from '@/services/goal';
import { useChatStore } from '@/store/chat';
import { goalSelectors, useGoalStore } from '@/store/goal';

import GoalAcceptanceCriteria from '../GoalAcceptanceCriteria';
import Activity from './Activity';
import Deliverables from './Deliverables';
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
  /** Owned by the page so it can swap its portal panel for the overlay's. */
  graphFullscreen: boolean;
  onGraphFullscreenChange: (fullscreen: boolean) => void;
}

const ProcessControl = memo<ProcessControlProps>(
  ({ goalId, graphFullscreen, onGraphFullscreenChange }) => {
    const { t } = useTranslation('chat');
    const { allowed: canEdit } = usePermission('create_content');
    const [selectedId, setSelectedId] = useState<string>();

    const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
    const decideGoal = useGoalStore((s) => s.decideGoal);
    const refreshGoalGraph = useGoalStore((s) => s.refreshGoalGraph);
    const openTaskResult = useChatStore((s) => s.openTaskResult);
    const openGoalNode = useChatStore((s) => s.openGoalNode);
    useFetchGoalGraph(goalId);
    const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));

    const graph = useMemo(() => (snapshot ? buildGoalGraphView(snapshot) : undefined), [snapshot]);

    const actions: FrontierActions = useMemo(
      () => ({
        addTask: async (title: string, description?: string) => {
          await goalService.addNode({ description, id: goalId, kind: 'task', title });
          await refreshGoalGraph(goalId);
        },
        decide: (decisionId, optionId, resolution) =>
          void decideGoal(goalId, { decisionId, optionId, resolution }),
      }),
      [decideGoal, goalId, refreshGoalGraph],
    );

    // Every click funnels here: keep the map highlight (spatial continuity) and
    // open the drill-down — a dispatched Task lands on its result-focused
    // review surface. The original editable Task remains one explicit step
    // deeper, so Goal inspection does not begin with implementation metadata.
    const select = useCallback(
      (nodeId: string) => {
        setSelectedId(nodeId);
        const taskId = graph?.byId[nodeId]?.node.taskId;
        if (taskId) openTaskResult(taskId);
        else openGoalNode(goalId, nodeId);
      },
      [goalId, graph, openGoalNode, openTaskResult],
    );

    // Task-carried goals share the `goals` table but never grow a graph. Nothing
    // to control here, so the page keeps its original shape.
    if (!graph || graph.nodes.length === 0) return null;

    // The coordinator is decomposing the problem into tasks. `running` with zero
    // Task counts too: the decomposition claim flips the status before the
    // planner returns, and a re-plan after all Tasks were removed is the same
    // state. The surfaces below promise the incoming structure instead of
    // reading as an empty goal — the graph poll fills them in as nodes land.
    const planning =
      ['planning', 'running'].includes(graph.goal.status) &&
      !graph.nodes.some((view) => view.node.kind === 'task');
    // Presence of the acceptance block (not a non-empty list) keeps the section
    // mounted: removing the last criterion must leave the add control reachable,
    // while legacy prose-only goals (no acceptance config at all) show nothing.
    const acceptanceConfig = graph.goal.config?.acceptance;
    const criteriaIds = acceptanceConfig?.criteriaIds ?? [];
    // A closed goal cannot move: the coordinator returns immediately for these,
    // and a Task added here would sit `proposed` forever. Stop offering actions
    // that cannot land. The goal otherwise advances entirely on its own — the
    // only legitimate human control over its pace is pause/resume.
    const closed = ['achieved', 'canceled', 'failed'].includes(graph.goal.status);
    const canAct = canEdit && !closed;

    return (
      <Flexbox gap={20}>
        <Flexbox gap={12}>
          <Frontier
            actions={actions}
            canEdit={canAct}
            graph={graph}
            planning={planning}
            onSelect={select}
          />
        </Flexbox>

        <Graph
          fullscreen={graphFullscreen}
          graph={graph}
          planning={planning}
          selectedId={selectedId}
          onFullscreenChange={onGraphFullscreenChange}
          onSelect={select}
        />

        <Accordion defaultExpandedKeys={['deliverables', 'findings', 'activity']} gap={0}>
          {/* The structured acceptance standard the terminal goal acceptance is
            gated on. Collapsed by default — reference material, like the task
            detail's 交付验收 section. Prose-only legacy goals have none. */}
          {!!acceptanceConfig && (
            <AccordionItem
              itemKey={'acceptance'}
              paddingBlock={6}
              paddingInline={0}
              title={
                <Flexbox horizontal align={'center'} gap={8}>
                  <Text fontSize={14} weight={600}>
                    {t('goalAcceptance.title')}
                  </Text>
                  {criteriaIds.length > 0 && <Tag size={'small'}>{criteriaIds.length}</Tag>}
                  <Text fontSize={12} type={'secondary'}>
                    {t('goalAcceptance.gateHint')}
                  </Text>
                </Flexbox>
              }
            >
              <Flexbox className={styles.section}>
                <GoalAcceptanceCriteria criteriaIds={criteriaIds} goalId={goalId} />
              </Flexbox>
            </AccordionItem>
          )}
          {/* Between the standard and the conclusions on purpose: 验收标准 says
              what counts as done, 交付物 what was produced, 结论 what the goal now
              believes about it. Findings routinely cite these artifacts. */}
          <AccordionItem
            itemKey={'deliverables'}
            paddingBlock={6}
            paddingInline={0}
            title={
              <Flexbox horizontal align={'center'} gap={8}>
                <Text fontSize={14} weight={600}>
                  {t('goalProcess.deliverables.title')}
                </Text>
                {graph.artifacts.length > 0 && <Tag size={'small'}>{graph.artifacts.length}</Tag>}
              </Flexbox>
            }
          >
            <Flexbox className={styles.section}>
              <Deliverables graph={graph} />
            </Flexbox>
          </AccordionItem>
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
  },
);

ProcessControl.displayName = 'GoalProcessControl';

export default ProcessControl;
