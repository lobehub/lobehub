import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Title = memo(() => {
  const { t } = useTranslation('chat');
  const view = useChatStore(chatPortalSelectors.goalMetricView);
  if (!view) return null;

  return (
    <Text style={{ fontSize: 14 }} weight={500}>
      {t(`goalProcess.metricDetail.${view.metric}.title` as const)}
    </Text>
  );
});

export default Title;
