import { BotIcon } from 'lucide-react';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { routeMeta } from '@/spa/router/routeMeta';

export const agentsRouteMeta = routeMeta({
  icon: BotIcon,
  Skeleton: createSurfaceSkeleton('grid'),
  titleKey: 'navigation.agents',
});
