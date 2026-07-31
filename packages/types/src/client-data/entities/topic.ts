import type { ChatTopicStatus } from '../../topic';

export interface TopicEntityFragments {
  activity: { updatedAt: Date | number | string };
  creation: { createdAt?: Date | number | string };
  display: { title: string };
  navigation: { routePath?: string };
  preview: {
    description?: string | null;
    lastAssistantMessage?: string | null;
    trigger?: string | null;
    userId?: string;
  };
  routing: { agentId?: string | null };
  runTiming: { runStartedAt?: Date | null };
  status: { status?: ChatTopicStatus | null };
}
