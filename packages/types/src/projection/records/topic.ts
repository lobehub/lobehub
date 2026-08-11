import type { ChatTopicMetadata, ChatTopicStatus } from '../../topic';

export interface TopicProjectionFragments {
  activity: { updatedAt: Date | number | string };
  analytics: {
    cost?: number | null;
    metadata?: ChatTopicMetadata | null;
    tokenUsage?: number | null;
  };
  completion: { completedAt?: Date | null };
  creation: { createdAt?: Date | number | string };
  details: {
    description: string | null;
    firstUserMessage: string | null;
    messageCount: number | null;
  };
  display: { title: string };
  generation: { model?: string | null; provider?: string | null };
  marking: { favorite?: boolean };
  navigation: { routePath?: string };
  ordering: { sortUpdatedAt?: number };
  ownership: { userId?: string };
  preview: {
    description?: string | null;
    lastAssistantMessage?: string | null;
  };
  routing: { agentId?: string | null; groupId?: string | null; sessionId?: string | null };
  runTiming: { runStartedAt?: Date | null };
  status: { status?: ChatTopicStatus | null };
  summary: { historySummary?: string | null };
  triggerInfo: { trigger?: string | null };
}
