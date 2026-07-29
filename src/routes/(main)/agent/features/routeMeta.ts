import {
  ChartColumnBigIcon,
  FileUserIcon,
  MessageSquare,
  MessagesSquareIcon,
  RadioTowerIcon,
} from 'lucide-react';
import { lazy } from 'react';

import { routeMeta } from '@/spa/router/routeMeta';

const AgentDynamicMeta = lazy(() => import('@/features/RouteMeta/AgentDynamicMeta'));
const TopicsDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.TopicsDynamicMeta,
  })),
);
const ProfileDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.ProfileDynamicMeta,
  })),
);
const ChannelDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.ChannelDynamicMeta,
  })),
);
const StatsDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.StatsDynamicMeta,
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

export const agentProfileRouteMeta = routeMeta({
  DynamicMeta: ProfileDynamicMeta,
  icon: FileUserIcon,
  titleKey: 'navigation.profile',
});

export const agentChannelRouteMeta = routeMeta({
  DynamicMeta: ChannelDynamicMeta,
  icon: RadioTowerIcon,
  titleKey: 'navigation.channels',
});

export const agentStatsRouteMeta = routeMeta({
  DynamicMeta: StatsDynamicMeta,
  icon: ChartColumnBigIcon,
  titleKey: 'navigation.stats',
});
