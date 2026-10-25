'use client';

import { Accordion, type AccordionItemType, Flexbox, Tag, Text } from '@lobehub/ui';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Lifecycle from '@/features/Portal/GoalMetric/Lifecycle';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';

import GoalAcceptanceCriteria from '../GoalAcceptanceCriteria';
import { buildDecisionRows } from './decisionList';
import Decisions from './Decisions';
import DeliveryTabs from './DeliveryTabs';
import Frontier from './Frontier';
import { buildGoalGraphView } from './goalGraphViewModel';
import GoalResultTabs from './GoalResultTabs';
import Graph from './Graph';
import {
  isGoalClosed,
  isGoalPlanning,
  useFrontierActions,
  useGoalNodeSelect,
} from './useGoalProcessActions';

// One left edge for headings and their content, so a section's rows line up
// under its title instead of sitting on an indent.
const SECTION_STYLES = {
  panel: { paddingInline: 0 },
  trigger: { paddingBlock: 8, paddingInline: 0 },
};

/**
 * The process-control band of the goal detail page: what can move now
 * (frontier), the map of how the goal got here, what it believes, and what it
 * has been doing. Once the goal finishes, this becomes the 执行过程 tab behind
 * its 结果交付 (see `GoalResultTabs`). Renders only for goals that actually
 * carry a Goal Graph — a plain task-carried goal has no nodes and keeps the
 * page it always had.
 */

interface ProcessControlProps {
  /** The `goals` row id — not the carrier task's identifier. */
  goalId: string;
  /** Owned by the page so it can swap its portal panel for the overlay's. */
  graphFullscreen: boolean;
  /** Sends a question about the delivered result into the goal's conversation. */
  onFollowUp?: (message: string) => void;
  onGraphFullscreenChange: (fullscreen: boolean) => void;
}

const ProcessControl = memo<ProcessControlProps>(
  ({ goalId, graphFullscreen, onFollowUp, onGraphFullscreenChange }) => {
    const { t } = useTranslation('chat');
    const { allowed: canEdit } = usePermission('create_content');
    const [lastSelectedId, setSelectedId] = useState<string>();
    const nodePortal = useChatStore(chatPortalSelectors.goalNodeView);
    const selectedId = nodePortal?.goalId === goalId ? nodePortal.nodeId : lastSelectedId;

    const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
    useFetchGoalGraph(goalId);
    const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));

    const graph = useMemo(() => (snapshot ? buildGoalGraphView(snapshot) : undefined), [snapshot]);

    const actions = useFrontierActions(goalId);
    const openNode = useGoalNodeSelect(goalId, graph);

    // Every click funnels here: keep the map highlight (spatial continuity) and
    // open the drill-down (see `useGoalNodeSelect` for where each node lands).
    const select = useCallback(
      (nodeId: string) => {
        setSelectedId(nodeId);
        openNode(nodeId);
      },
      [openNode],
    );

    // Task-carried goals share the `goals` table but never grow a graph. Nothing
    // to control here, so the page keeps its original shape.
    if (!graph || graph.nodes.length === 0) return null;

    // While the coordinator decomposes the problem, the surfaces below promise
    // the incoming structure instead of reading as an empty goal — the graph
    // poll fills them in as nodes land.
    const planning = isGoalPlanning(graph);
    const decisionCount = buildDecisionRows(graph.decisions).length;
    // Presence of the acceptance block (not a non-empty list) keeps the section
    // mounted: removing the last criterion must leave the add control reachable,
    // while legacy prose-only goals (no acceptance config at all) show nothing.
    const acceptanceConfig = graph.goal.config?.acceptance;
    const criteriaIds = acceptanceConfig?.criteriaIds ?? [];
    // Stop offering actions that cannot land on a closed goal. The goal otherwise
    // advances entirely on its own — the only legitimate human control over its
    // pace is pause/resume.
    const canAct = canEdit && !isGoalClosed(graph);

    const map = (
      <Graph
        fullscreen={graphFullscreen}
        graph={graph}
        key={goalId}
        planning={planning}
        selectedId={selectedId}
        onFullscreenChange={onGraphFullscreenChange}
        onSelect={select}
      />
    );

    const process = (
      <Flexbox gap={40}>
        {/* What waits on the reader comes first; the map explains it below. The
            wide gap keeps the two reading as separate sections, not one block. */}
        <Flexbox gap={12}>
          <Frontier
            actions={actions}
            canEdit={canAct}
            graph={graph}
            planning={planning}
            onSelect={select}
          />
        </Flexbox>

        {map}

        {/* The structured acceptance standard the terminal goal acceptance is
            gated on. Collapsed by default — reference material, like the task
            detail's 交付验收 section. Prose-only legacy goals have none. */}
        {!!acceptanceConfig && (
          <Accordion
            indicatorPlacement="inline"
            styles={SECTION_STYLES}
            items={[
              {
                children: <GoalAcceptanceCriteria criteriaIds={criteriaIds} goalId={goalId} />,
                key: 'acceptance',
                title: (
                  <Flexbox horizontal align={'center'} gap={8}>
                    <Text fontSize={14} weight={600}>
                      {t('goalAcceptance.title')}
                    </Text>
                    {criteriaIds.length > 0 && <Tag size={'small'}>{criteriaIds.length}</Tag>}
                    <Text fontSize={12} type={'secondary'}>
                      {t('goalAcceptance.gateHint')}
                    </Text>
                  </Flexbox>
                ),
              },
            ]}
          />
        )}

        {/* 验收标准 says what counts as done, 交付物 what was produced, 结论 what the
            goal now believes about it — the last two share one tabbed block. */}
        <DeliveryTabs graph={graph} onSelect={select} />

        <Accordion
          defaultValue={['decisions', 'activity']}
          gap={16}
          indicatorPlacement="inline"
          styles={SECTION_STYLES}
          items={
            [
              // Where a person stepped into the run — kept apart from the
              // results above, which are what the run produced on its own.
              decisionCount > 0 && {
                children: <Decisions graph={graph} onSelect={select} />,
                key: 'decisions',
                title: (
                  <Flexbox horizontal align={'center'} gap={8}>
                    <Text fontSize={14} weight={600}>
                      {t('goalProcess.decisions.title')}
                    </Text>
                    <Tag size={'small'}>{decisionCount}</Tag>
                  </Flexbox>
                ),
              },
              {
                // The timeline carries who decided what (a person's gate answer
                // reads as their own line), not just what the tasks did. It
                // lands on the shared `select` so a timeline click also moves
                // the map's highlight, as the list it replaced did.
                children: (
                  <Lifecycle goalId={goalId} graph={graph} stickyDays={false} onSelect={select} />
                ),
                key: 'activity',
                title: (
                  <Text fontSize={14} weight={600}>
                    {t('goalProcess.activity.title')}
                  </Text>
                ),
              },
            ].filter(Boolean) as AccordionItemType[]
          }
        />
      </Flexbox>
    );

    return (
      <GoalResultTabs
        graph={graph}
        key={goalId}
        process={process}
        onFollowUp={onFollowUp}
        onSelect={select}
      />
    );
  },
);

ProcessControl.displayName = 'GoalProcessControl';

export default ProcessControl;
