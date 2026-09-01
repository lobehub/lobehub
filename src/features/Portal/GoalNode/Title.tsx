import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

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
    return buildGoalGraphView(snapshot).byId[view.nodeId]?.node;
  }, [snapshot, view]);

  return (
    <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
      {node && <KindIcon kind={node.kind} />}
      <Text className={oneLineEllipsis} style={{ flex: 1, fontSize: 14, minWidth: 0 }}>
        {node?.title ?? t('goalProcess.node.detailTitle')}
      </Text>
    </Flexbox>
  );
});

export default Title;
