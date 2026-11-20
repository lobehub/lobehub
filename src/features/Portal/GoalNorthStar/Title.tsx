import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';

const Title = memo(() => {
  const { t } = useTranslation('chat');
  const view = useChatStore(chatPortalSelectors.goalNorthStarView);
  const criterion = useGoalStore((s) =>
    view
      ? goalSelectors
          .goalGraph(view.goalId)(s)
          ?.goal.config?.acceptance?.metrics?.find((item) => item.key === view.metricKey)
      : undefined,
  );
  if (!view) return null;

  return (
    <Text style={{ fontSize: 14 }} weight={500}>
      {criterion?.title || view.metricKey || t('goalProcess.northStar.detail.title')}
    </Text>
  );
});

export default Title;
