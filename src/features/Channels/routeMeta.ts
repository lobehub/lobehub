import { Hash, Settings } from 'lucide-react';
import { lazy } from 'react';

import ChannelLayoutSkeleton from '@/components/Skeleton/Channel';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { routeMeta } from '@/spa/router/routeMeta';

// Route metas load with the router on first paint; keep the Channel store out of that graph.
const ChannelDynamicMeta = lazy(() => import('./ChannelDynamicMeta'));

export const channelRouteMeta = routeMeta({
  DynamicMeta: ChannelDynamicMeta,
  icon: Hash,
  Skeleton: ChannelLayoutSkeleton,
  titleKey: 'channel:title',
});

export const channelSettingsRouteMeta = routeMeta({
  icon: Settings,
  Skeleton: createSurfaceSkeleton('form'),
  titleKey: 'channel:settings.title',
});
