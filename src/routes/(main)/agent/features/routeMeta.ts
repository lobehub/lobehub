import { MessageSquare, MessagesSquareIcon } from 'lucide-react';
import { lazy } from 'react';

import { routeMeta } from '@/spa/router/routeMeta';

const AgentDynamicMeta = lazy(() => import('@/features/RouteMeta/AgentDynamicMeta'));
const TopicsDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.TopicsDynamicMeta,
  })),
);

export const agentRouteMeta = routeMeta({
  DynamicMeta: AgentDynamicMeta,
  icon: MessageSquare,
  titleKey: 'navigation.chat',
});

export const topicsRouteMeta = routeMeta({
  DynamicMeta: TopicsDynamicMeta,
  icon: MessagesSquareIcon,
  titleKey: 'navigation.topics',
});
