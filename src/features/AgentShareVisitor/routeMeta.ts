import { MessageSquareShareIcon } from 'lucide-react';

import ConversationLayoutSkeleton from '@/components/Skeleton/Conversation/Layout';
import { routeMeta } from '@/spa/router/routeMeta';

/**
 * Agent-share visitor surface (`/agent/:slugOrId`). The shared agent's
 * name only becomes known after `getSharedAgent` resolves, so the tab title
 * stays on the generic share label rather than flashing a placeholder name.
 */
export const agentShareVisitorRouteMeta = routeMeta({
  icon: MessageSquareShareIcon,
  Skeleton: ConversationLayoutSkeleton,
  titleKey: 'navigation.sharedAgent',
});
