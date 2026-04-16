import { memo } from 'react';

import { useInitRecentPage } from '@/hooks/useInitRecentPage';
import { useInitRecentResource } from '@/hooks/useInitRecentResource';
import { useInitRecents } from '@/hooks/useInitRecents';
import { useInitRecentTopic } from '@/hooks/useInitRecentTopic';

const RecentHydration = memo(() => {
  useInitRecentTopic();
  useInitRecentResource();
  useInitRecentPage();
  useInitRecents();

  return null;
});

export default RecentHydration;
