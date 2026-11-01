import { BotIcon } from 'lucide-react';

import AgentViewAllSkeleton from '@/components/Skeleton/AgentViewAll';
import { routeMeta } from '@/spa/router/routeMeta';

export const agentsRouteMeta = routeMeta({
  icon: BotIcon,
  Skeleton: AgentViewAllSkeleton,
  titleKey: 'navigation.agents',
});
