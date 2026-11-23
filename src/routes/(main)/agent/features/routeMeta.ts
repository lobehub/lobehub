import {
  ChartColumnBigIcon,
  CpuIcon,
  FileTextIcon,
  FileUserIcon,
  GitBranchIcon,
  GraduationCapIcon,
  LibraryBigIcon,
  MailIcon,
  MessageSquare,
  MessageSquareHeartIcon,
  MessagesSquareIcon,
  MonitorSmartphoneIcon,
  RadioTowerIcon,
  ScrollTextIcon,
  Share2Icon,
  SparklesIcon,
  UsersIcon,
  WebhookIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react';
import { lazy } from 'react';

import {
  AgentChannelDetailSkeleton,
  AgentChannelSkeleton,
} from '@/components/Skeleton/AgentChannel';
import AgentShareSkeleton from '@/components/Skeleton/AgentShare';
import AgentStatisticsSkeleton from '@/components/Skeleton/AgentStatistics';
import AgentConversationLayoutSkeleton from '@/components/Skeleton/Conversation/AgentLayout';
import ConversationLayoutSkeleton from '@/components/Skeleton/Conversation/Layout';
import ReadOnlyConversationSkeleton from '@/components/Skeleton/Conversation/ReadOnly';
import ProfileSkeleton from '@/components/Skeleton/Profile';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import TopicsSkeleton from '@/components/Skeleton/Topics';
import { goalsRouteMeta } from '@/features/AgentGoals/routeMeta';
import { tasksRouteMeta } from '@/features/AgentTasks/routeMeta';
import { NoRouteSkeleton, routeMeta } from '@/spa/router/routeMeta';

const AgentDynamicMeta = lazy(() => import('@/features/RouteMeta/AgentDynamicMeta'));
const TopicsDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.TopicsDynamicMeta,
  })),
);
const OpeningDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.OpeningDynamicMeta,
  })),
);
const GraphDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.GraphDynamicMeta,
  })),
);
const EngineDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.EngineDynamicMeta,
  })),
);
const InstructionDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.InstructionDynamicMeta,
  })),
);
const KnowledgeDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.KnowledgeDynamicMeta,
  })),
);
const SkillsDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.SkillsDynamicMeta,
  })),
);
const EnvironmentDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.EnvironmentDynamicMeta,
  })),
);
const ToolsDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.ToolsDynamicMeta,
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

const DocumentsDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.DocumentsDynamicMeta,
  })),
);
const GoalsDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.GoalsDynamicMeta,
  })),
);
const TasksDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.TasksDynamicMeta,
  })),
);
const MailDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.MailDynamicMeta,
  })),
);
const AutomationsDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.AutomationsDynamicMeta,
  })),
);
const WebhookDynamicMeta = lazy(() =>
  import('@/features/RouteMeta/AgentDynamicMeta').then((module) => ({
    default: module.WebhookDynamicMeta,
  })),
);

export const agentRouteMeta = routeMeta({
  DynamicMeta: AgentDynamicMeta,
  icon: MessageSquare,
  Skeleton: ConversationLayoutSkeleton,
  titleKey: 'navigation.chat',
});

// Desktop mounts the working sidebar beside the conversation; mobile does not.
export const agentChatDesktopRouteMeta = routeMeta({
  ...agentRouteMeta,
  Skeleton: AgentConversationLayoutSkeleton,
});

/** A share visitor's run topic, read-only beside the Agent sidebar. */
export const agentShareVisitorTopicRouteMeta = routeMeta({
  // Titled like the Topics page (`Topics · <agent>`): the visitor transcript is fetched by the
  // page, and a background tab should not poll it just to name itself.
  DynamicMeta: TopicsDynamicMeta,
  icon: MessagesSquareIcon,
  Skeleton: ReadOnlyConversationSkeleton,
  titleKey: 'navigation.topics',
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

export const agentInstructionRouteMeta = routeMeta({
  DynamicMeta: InstructionDynamicMeta,
  icon: ScrollTextIcon,
  Skeleton: ProfileSkeleton,
  titleKey: 'navigation.instruction',
});

export const agentKnowledgeRouteMeta = routeMeta({
  DynamicMeta: KnowledgeDynamicMeta,
  icon: LibraryBigIcon,
  Skeleton: ProfileSkeleton,
  titleKey: 'navigation.knowledge',
});

export const agentSkillsRouteMeta = routeMeta({
  DynamicMeta: SkillsDynamicMeta,
  icon: SparklesIcon,
  Skeleton: ProfileSkeleton,
  titleKey: 'navigation.skills',
});

export const agentEngineRouteMeta = routeMeta({
  DynamicMeta: EngineDynamicMeta,
  icon: CpuIcon,
  Skeleton: ProfileSkeleton,
  titleKey: 'navigation.engine',
});

export const agentEnvironmentRouteMeta = routeMeta({
  DynamicMeta: EnvironmentDynamicMeta,
  icon: MonitorSmartphoneIcon,
  Skeleton: ProfileSkeleton,
  titleKey: 'navigation.environment',
});

export const agentToolsRouteMeta = routeMeta({
  DynamicMeta: ToolsDynamicMeta,
  icon: WrenchIcon,
  Skeleton: ProfileSkeleton,
  titleKey: 'navigation.tools',
});

export const agentMailRouteMeta = routeMeta({
  DynamicMeta: MailDynamicMeta,
  icon: MailIcon,
  Skeleton: createSurfaceSkeleton('list'),
  titleKey: 'navigation.mail',
});

export const agentAutomationsRouteMeta = routeMeta({
  DynamicMeta: AutomationsDynamicMeta,
  icon: ZapIcon,
  Skeleton: createSurfaceSkeleton('list'),
  titleKey: 'navigation.automations',
});

export const agentWebhookRouteMeta = routeMeta({
  DynamicMeta: WebhookDynamicMeta,
  icon: WebhookIcon,
  Skeleton: createSurfaceSkeleton('list'),
  titleKey: 'navigation.webhook',
});

export const agentChannelRouteMeta = routeMeta({
  DynamicMeta: ChannelDynamicMeta,
  icon: RadioTowerIcon,
  Skeleton: AgentChannelSkeleton,
  titleKey: 'navigation.channels',
});

// A platform detail is a credential form without the tab switcher, not the card grid.
export const agentChannelDetailRouteMeta = routeMeta({
  ...agentChannelRouteMeta,
  Skeleton: AgentChannelDetailSkeleton,
});

export const agentStatisticsRouteMeta = routeMeta({
  DynamicMeta: StatisticsDynamicMeta,
  icon: ChartColumnBigIcon,
  Skeleton: AgentStatisticsSkeleton,
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

export const agentOpeningRouteMeta = routeMeta({
  DynamicMeta: OpeningDynamicMeta,
  icon: MessageSquareHeartIcon,
  Skeleton: createSurfaceSkeleton('form'),
  titleKey: 'navigation.opening',
});

export const agentGraphRouteMeta = routeMeta({
  DynamicMeta: GraphDynamicMeta,
  icon: GitBranchIcon,
  Skeleton: createSurfaceSkeleton('form'),
  titleKey: 'navigation.graph',
});

export const agentPermissionRouteMeta = routeMeta({
  DynamicMeta: PermissionDynamicMeta,
  icon: UsersIcon,
  Skeleton: createSurfaceSkeleton('form'),
  titleKey: 'navigation.permission',
});

// Goals and Tasks are also mounted at workspace and project level, where there is no
// agent to name, so only their agent-scoped mounts take the agent section title.
export const agentGoalsRouteMeta = routeMeta({
  ...goalsRouteMeta,
  DynamicMeta: GoalsDynamicMeta,
});

export const agentTasksRouteMeta = routeMeta({
  ...tasksRouteMeta,
  DynamicMeta: TasksDynamicMeta,
});

export const agentDocumentsRouteMeta = routeMeta({
  DynamicMeta: DocumentsDynamicMeta,
  icon: FileTextIcon,
  Skeleton: NoRouteSkeleton,
  titleKey: 'navigation.document',
});
