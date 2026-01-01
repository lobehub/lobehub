import { memo } from 'react';

import { useInitRecentPage } from '@/hooks/useInitRecentPage';
import { useInitRecentResource } from '@/hooks/useInitRecentResource';
import { useInitRecentTopic } from '@/hooks/useInitRecentTopic';

const RecentHydration = memo(() => {
  useInitRecentTopic();
  useInitRecentResource();
  useInitRecentPage();

  return null;
});

export default RecentHydration;
