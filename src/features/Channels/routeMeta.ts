import { Hash } from 'lucide-react';
import { lazy } from 'react';

import ChannelLayoutSkeleton from '@/components/Skeleton/Channel';
import { routeMeta } from '@/spa/router/routeMeta';

// Route metas load with the router on first paint; keep the Channel store out of that graph.
const ChannelDynamicMeta = lazy(() => import('./ChannelDynamicMeta'));

export const channelRouteMeta = routeMeta({
  DynamicMeta: ChannelDynamicMeta,
  icon: Hash,
  Skeleton: ChannelLayoutSkeleton,
  titleKey: 'channel:title',
});
