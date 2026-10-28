import { Hash } from 'lucide-react';
import { lazy } from 'react';

import ConversationSegmentSkeleton from '@/components/Skeleton/Conversation/Segment';
import { routeMeta } from '@/spa/router/routeMeta';

// Route metas load with the router on first paint; keep the Channel store out of that graph.
const ChannelDynamicMeta = lazy(() => import('./ChannelDynamicMeta'));

export const channelRouteMeta = routeMeta({
  DynamicMeta: ChannelDynamicMeta,
  icon: Hash,
  Skeleton: ConversationSegmentSkeleton,
  titleKey: 'channel:title',
});
