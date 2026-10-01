import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GoalStatusGlyph from '@/features/AgentGoals/GoalStatusGlyph';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';
import { oneLineEllipsis } from '@/styles';

const Title = memo(() => {
  const { t } = useTranslation('chat');
  const goalId = useChatStore(chatPortalSelectors.goalPortalId);
  const goal = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal);

  return (
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      {goal && <GoalStatusGlyph size={14} status={goal.status} />}
      <Text className={oneLineEllipsis} style={{ flex: '0 1 auto', fontSize: 14, minWidth: 0 }}>
        {goal?.title ?? t('goalProcess.portal.title')}
      </Text>
    </Flexbox>
  );
});

Title.displayName = 'GoalPortalTitle';

export default Title;
