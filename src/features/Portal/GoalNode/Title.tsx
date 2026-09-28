import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { graphNodeKind } from '@/features/AgentGoals/Experiments/model';
import { buildGoalGraphView } from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import { KindIcon } from '@/features/AgentGoals/ProcessControl/shared';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';
import { oneLineEllipsis } from '@/styles';

const Title = memo(() => {
  const { t } = useTranslation('chat');
  const view = useChatStore(chatPortalSelectors.goalNodeView);
  const snapshot = useGoalStore(goalSelectors.goalGraph(view?.goalId ?? ''));
  const node = useMemo(() => {
    if (!snapshot || !view) return undefined;
    const graph = buildGoalGraphView(snapshot);
    const nodeView = graph.byId[view.nodeId];
    return nodeView ? { ...nodeView.node, kind: graphNodeKind(graph, nodeView) } : undefined;
  }, [snapshot, view]);

  return (
    // Hug the content so the shared `…` sits right after the title.
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      {node && <KindIcon kind={node.kind} />}
      <Text className={oneLineEllipsis} style={{ flex: '0 1 auto', fontSize: 14, minWidth: 0 }}>
        {node?.title ?? t('goalProcess.node.detailTitle')}
      </Text>
    </Flexbox>
  );
});

export default Title;
