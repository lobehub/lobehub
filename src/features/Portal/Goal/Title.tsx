import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { SquareArrowOutUpRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GoalStatusGlyph from '@/features/AgentGoals/GoalStatusGlyph';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';
import { oneLineEllipsis } from '@/styles';

import { useOpenGoalPage } from './useOpenGoalPage';

const Title = memo(() => {
  const { t } = useTranslation('chat');
  const goalId = useChatStore(chatPortalSelectors.goalPortalId);
  const goal = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal);
  const openGoalPage = useOpenGoalPage(goalId);

  return (
    <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
      {goal && <GoalStatusGlyph size={14} status={goal.status} />}
      <Text className={oneLineEllipsis} style={{ flex: '0 1 auto', fontSize: 14, minWidth: 0 }}>
        {goal?.title ?? t('goalProcess.portal.title')}
      </Text>
      {openGoalPage && (
        <ActionIcon
          aria-label={t('goalProcess.portal.openPage')}
          icon={SquareArrowOutUpRight}
          size={'small'}
          style={{ flexShrink: 0 }}
          title={t('goalProcess.portal.openPage')}
          onClick={openGoalPage}
        />
      )}
    </Flexbox>
  );
});

Title.displayName = 'GoalPortalTitle';

export default Title;
