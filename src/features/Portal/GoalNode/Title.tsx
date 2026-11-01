import { Flexbox, Icon, Text } from '@lobehub/ui';
import { DoorOpen } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { graphNodeKind } from '@/features/AgentGoals/Experiments/model';
import { usePlanVersionSelection } from '@/features/AgentGoals/ProcessControl/BatchPlan/planVersion';
import { coordinatorNodeTitleKey } from '@/features/AgentGoals/ProcessControl/coordinatorCopy';
import { buildGoalGraphView } from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import {
  batchPlanTitleKey,
  findBatchGate,
  findBatchPlan,
} from '@/features/AgentGoals/ProcessControl/Graph/batchModel';
import {
  GATE_COLOR,
  KindIcon,
  SKILL_COLOR,
  SKILL_ICON,
} from '@/features/AgentGoals/ProcessControl/shared';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';
import { oneLineEllipsis } from '@/styles';

const Title = memo(() => {
  const { t } = useTranslation('chat');
  const view = useChatStore(chatPortalSelectors.goalNodeView);
  const snapshot = useGoalStore(goalSelectors.goalGraph(view?.goalId ?? ''));
  // A plan's title names the version the header picked.
  const { selected } = usePlanVersionSelection();
  const node = useMemo(() => {
    if (!snapshot || !view) return undefined;
    const graph = buildGoalGraphView(snapshot);
    const nodeView = graph.byId[view.nodeId];
    if (!nodeView) return undefined;
    // Coordinator-authored titles are English; a batch gate also names its round.
    const revision = findBatchGate(graph, nodeView.node.id)?.round.revision;
    const plan = findBatchPlan(graph, nodeView.node.id);
    const titleKey = coordinatorNodeTitleKey(nodeView);
    // `selected` is a plan skill version; a round rewritten in place spans several.
    const planRound = plan
      ? (plan.model.rounds.find((item) => item.planVersion === selected) ?? plan.round)
      : undefined;
    const title = plan
      ? t(batchPlanTitleKey(plan.model, planRound!), {
          revision: selected ?? planRound!.planVersion,
        })
      : revision && revision > 1
        ? t('goalBatch.gate.titleRound', { revision })
        : titleKey
          ? t(titleKey as any)
          : nodeView.node.title;
    return {
      gate: !!revision,
      kind: graphNodeKind(graph, nodeView),
      skill: !!plan?.model.planSkill,
      title,
    };
  }, [snapshot, view, t, selected]);

  return (
    // Hug the content so the shared `…` sits right after the title.
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      {node &&
        (node.gate ? (
          <Icon color={GATE_COLOR.line} icon={DoorOpen} size={14} />
        ) : node.skill ? (
          <Icon color={SKILL_COLOR.line} icon={SKILL_ICON} size={14} />
        ) : (
          <KindIcon kind={node.kind} />
        ))}
      <Text className={oneLineEllipsis} style={{ flex: '0 1 auto', fontSize: 14, minWidth: 0 }}>
        {node?.title ?? t('goalProcess.node.detailTitle')}
      </Text>
    </Flexbox>
  );
});

export default Title;
