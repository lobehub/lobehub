import { MessageSquareShareIcon } from 'lucide-react';

import AgentShareVisitorSkeleton from '@/components/Skeleton/AgentShareVisitor';
import { routeMeta } from '@/spa/router/routeMeta';

/**
 * Agent-share visitor surface (`/a/:slugOrId`). The shared agent's name only
 * becomes known after `getSharedAgent` resolves, so the tab title stays on the
 * generic share label rather than flashing a placeholder name.
 */
export const agentShareVisitorRouteMeta = routeMeta({
  icon: MessageSquareShareIcon,
  Skeleton: AgentShareVisitorSkeleton,
  titleKey: 'navigation.sharedAgent',
});
