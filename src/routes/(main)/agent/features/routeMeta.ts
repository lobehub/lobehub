import {
  ChartColumnBigIcon,
  FileUserIcon,
  GraduationCapIcon,
  MessageSquare,
  MessagesSquareIcon,
  RadioTowerIcon,
  Share2Icon,
  UsersIcon,
} from 'lucide-react';
import { lazy } from 'react';

import AgentShareSkeleton from '@/components/Skeleton/AgentShare';
import ConversationLayoutSkeleton from '@/components/Skeleton/Conversation/Layout';
import ProfileSkeleton from '@/components/Skeleton/Profile';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import TopicsSkeleton from '@/components/Skeleton/Topics';
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
const StatisticsDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.StatisticsDynamicMeta,
  })),
);
const ShareDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.ShareDynamicMeta,
  })),
);
const SelfLearningDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.SelfLearningDynamicMeta,
  })),
);
const PermissionDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.PermissionDynamicMeta,
  })),
);

export const agentRouteMeta = routeMeta({
  DynamicMeta: AgentDynamicMeta,
  icon: MessageSquare,
  Skeleton: ConversationLayoutSkeleton,
  titleKey: 'navigation.chat',
});

export const topicsRouteMeta = routeMeta({
  DynamicMeta: TopicsDynamicMeta,
  icon: MessagesSquareIcon,
  Skeleton: TopicsSkeleton,
  titleKey: 'navigation.topics',
});

export const agentProfileRouteMeta = routeMeta({
  DynamicMeta: ProfileDynamicMeta,
  icon: FileUserIcon,
  Skeleton: ProfileSkeleton,
  titleKey: 'navigation.profile',
});

export const agentChannelRouteMeta = routeMeta({
  DynamicMeta: ChannelDynamicMeta,
  icon: RadioTowerIcon,
  Skeleton: createSurfaceSkeleton('grid'),
  titleKey: 'navigation.channels',
});

export const agentStatisticsRouteMeta = routeMeta({
  DynamicMeta: StatisticsDynamicMeta,
  icon: ChartColumnBigIcon,
  Skeleton: createSurfaceSkeleton('grid'),
  titleKey: 'navigation.stats',
});

export const agentShareRouteMeta = routeMeta({
  DynamicMeta: ShareDynamicMeta,
  icon: Share2Icon,
  Skeleton: AgentShareSkeleton,
  titleKey: 'navigation.agentShare',
});

export const agentSelfLearningRouteMeta = routeMeta({
  DynamicMeta: SelfLearningDynamicMeta,
  icon: GraduationCapIcon,
  Skeleton: createSurfaceSkeleton('list'),
  titleKey: 'navigation.selfLearning',
});

export const agentPermissionRouteMeta = routeMeta({
  DynamicMeta: PermissionDynamicMeta,
  icon: UsersIcon,
  Skeleton: createSurfaceSkeleton('form'),
  titleKey: 'navigation.permission',
});
