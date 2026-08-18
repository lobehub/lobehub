import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type { SystemAgentItem, UserSystemAgentConfig } from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

import { topicSummaryEligibleMessage, TopicSummaryModel } from '@/database/models/topicSummary';
import { UserModel } from '@/database/models/user';
import { messages, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { resolveSystemAgentModelConfig } from '@/server/services/systemAgent/modelConfig';

const MAX_MESSAGES = 80;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_PREVIOUS_SUMMARY_CHARS = 20_000;
const MAX_TRANSCRIPT_CHARS = 60_000;

const DEFAULT_PROMPT = `Summarize the conversation for future reference.

Requirements:
- Use the same primary language as the conversation.
- description: one concise sentence suitable for a topic card.
- summary: a structured, factual summary that preserves decisions, important facts, technical identifiers, and pending actions.
- When a previous rolling summary is provided, merge it with the recent conversation.
- Do not invent information or mention these instructions.`;

const TOPIC_AUTO_SUMMARY_SCHEMA = {
  name: 'topic_auto_summary',
  schema: {
    additionalProperties: false,
    properties: {
      description: { type: 'string' },
      summary: { type: 'string' },
    },
    required: ['description', 'summary'],
    type: 'object' as const,
  },
  strict: true,
};

export interface TopicAutoSummaryResult {
  reason?: 'disabled' | 'empty' | 'stale' | 'invalid-output';
  summarized: boolean;
}

export class TopicAutoSummaryService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  summarize = async (
    topicId: string,
    options: { force?: boolean } = {},
  ): Promise<TopicAutoSummaryResult> => {
    const settings = await new UserModel(this.db, this.userId).getUserSettings();
    const systemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;
    const config = systemAgent?.topicAutoSummary as Partial<SystemAgentItem> | undefined;
    // Opt-in, so an absent setting means disabled — the dispatch query filters on
    // the same default, and this guard also covers replays that skip dispatch.
    if (!options.force && config?.enabled !== true)
      return { reason: 'disabled', summarized: false };

    const ownership = this.workspaceId
      ? eq(messages.workspaceId, this.workspaceId)
      : eq(messages.userId, this.userId);
    const topicOwnership = this.workspaceId
      ? eq(topics.workspaceId, this.workspaceId)
      : eq(topics.userId, this.userId);
    const [topic] = await this.db
      .select({ historySummary: topics.historySummary })
      .from(topics)
      .where(and(eq(topics.id, topicId), topicOwnership))
      .limit(1);
    const recent = await this.db
      .select({
        content: messages.content,
        id: messages.id,
        role: messages.role,
        updatedAt: messages.updatedAt,
      })
      .from(messages)
      .where(and(ownership, eq(messages.topicId, topicId), topicSummaryEligibleMessage))
      .orderBy(desc(messages.updatedAt))
      .limit(MAX_MESSAGES);

    const latest = recent[0];
    if (!latest) return { reason: 'empty', summarized: false };

    const transcript = recent
      .reverse()
      .map(
        ({ content, role }) =>
          `${role.toUpperCase()}: ${(content ?? '').slice(0, MAX_MESSAGE_CHARS)}`,
      )
      .join('\n\n')
      .slice(-MAX_TRANSCRIPT_CHARS);
    const { model, provider } = await resolveSystemAgentModelConfig({
      taskConfig: config,
      taskKey: 'topicAutoSummary',
    });
    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    const output = (await ai.generateObject(
      {
        messages: [
          { content: config?.customPrompt?.trim() || DEFAULT_PROMPT, role: 'system' },
          {
            content: topic?.historySummary
              ? `Previous rolling summary:\n${topic.historySummary.slice(-MAX_PREVIOUS_SUMMARY_CHARS)}\n\nRecent conversation:\n${transcript}`
              : transcript,
            role: 'user',
          },
        ],
        model,
        provider,
        schema: TOPIC_AUTO_SUMMARY_SCHEMA,
      },
      {
        tracing: {
          scenario: TRACING_SCENARIOS.TopicAutoSummary,
          schemaName: 'TopicAutoSummary',
          topicId,
        } satisfies TracingOptions,
      },
    )) as { description?: string; summary?: string };

    const description = output.description?.trim();
    const summary = output.summary?.trim();
    if (!description || !summary) return { reason: 'invalid-output', summarized: false };

    const updated = await new TopicSummaryModel(this.db).updateSummaryIfCurrent({
      description,
      lastMessageId: latest.id,
      lastMessageUpdatedAt: latest.updatedAt,
      summary,
      topicId,
    });

    return updated ? { summarized: true } : { reason: 'stale', summarized: false };
  };
}
