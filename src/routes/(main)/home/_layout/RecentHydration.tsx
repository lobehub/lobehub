import { memo } from 'react';

import { useInitRecents } from '@/hooks/useInitRecents';

const RecentHydration = memo(() => {
  useInitRecents();

  return null;
});

export default RecentHydration;
