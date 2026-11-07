import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import {
  chainTopicAutoSummary,
  TOPIC_AUTO_SUMMARY_JSON_SCHEMA,
  TOPIC_AUTO_SUMMARY_PROMPT_VERSION,
} from '@lobechat/prompts';
import type { SystemAgentItem, UserSystemAgentConfig } from '@lobechat/types';
import { AgentRuntimeErrorType, RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { and, desc, eq } from 'drizzle-orm';

import { analyzeTopic, isTopicAnalysisEnabled } from '@/business/server/topicAnalysis';
import { TopicAnalysisModel } from '@/database/models/topicAnalysis';
import { topicSummaryEligibleMessage, TopicSummaryModel } from '@/database/models/topicSummary';
import { UserModel } from '@/database/models/user';
import { messages, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { notTrashed } from '@/database/utils/softDelete';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { resolveSystemAgentModelConfig } from '@/server/services/systemAgent/modelConfig';

const log = debug('lobe-server:service:topic-auto-summary');

const MAX_MESSAGES = 80;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_PREVIOUS_SUMMARY_CHARS = 20_000;
const MAX_TRANSCRIPT_CHARS = 60_000;

type SkipReason = 'disabled' | 'empty' | 'stale';

export interface TopicAutoSummaryResult {
  reason?: SkipReason | 'invalid-output' | 'no-executor';
  summarized: boolean;
}

export interface TopicAnalysisOutcome {
  analyzed: boolean;
  reason?: SkipReason | 'invalid-output' | 'no-executor';
}

interface TopicContext {
  config: Partial<SystemAgentItem> | undefined;
  historySummary: string | null;
  latest: { id: string; updatedAt: Date };
  transcript: string;
}

const isClientOnlyModelError = (error: unknown) =>
  (error as { errorType?: unknown })?.errorType ===
  AgentRuntimeErrorType.ClientLlmExecutorUnavailable;

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
    const loaded = await this.loadContext(topicId, options.force);
    if ('reason' in loaded) return { reason: loaded.reason, summarized: false };
    const { config, historySummary, latest, transcript } = loaded.context;

    const { model, provider } = await resolveSystemAgentModelConfig({
      taskConfig: config,
      taskKey: 'topicAutoSummary',
    });
    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    let output: { description?: string; summary?: string };
    try {
      output = (await ai.generateObject(
        {
          ...chainTopicAutoSummary({
            customPrompt: config?.customPrompt,
            previousSummary: historySummary?.slice(-MAX_PREVIOUS_SUMMARY_CHARS),
            transcript,
          }),
          model,
          provider,
          schema: TOPIC_AUTO_SUMMARY_JSON_SCHEMA,
        },
        {
          metadata: { trigger: RequestTrigger.TopicSummary },
          tracing: {
            promptVersion: TOPIC_AUTO_SUMMARY_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.TopicAutoSummary,
            schemaName: TOPIC_AUTO_SUMMARY_JSON_SCHEMA.name,
            topicId,
          } satisfies TracingOptions,
        },
      )) as { description?: string; summary?: string };
    } catch (error) {
      // A device-only model (Ollama, LM Studio) runs in the user's open tab,
      // and this summary runs in a workflow with no tab attached. That is a
      // settled outcome, not a transient failure: skip the summary instead of
      // failing the step, which would only make the workflow retry in vain.
      if (isClientOnlyModelError(error)) {
        log('skip topic %s: %s has no executor outside a browser tab', topicId, provider);
        return { reason: 'no-executor', summarized: false };
      }
      throw error;
    }

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

  /**
   * Classify the topic from its rolling summary plus the recent transcript, and
   * record the result. Runs as its own workflow step after a successful summary,
   * so a failure retries only the analysis, never the committed summary.
   */
  analyze = async (
    topicId: string,
    options: { force?: boolean } = {},
  ): Promise<TopicAnalysisOutcome> => {
    if (!isTopicAnalysisEnabled()) return { analyzed: false, reason: 'disabled' };

    const loaded = await this.loadContext(topicId, options.force);
    if ('reason' in loaded) return { analyzed: false, reason: loaded.reason };
    const { config, historySummary, latest, transcript } = loaded.context;

    const { model, provider } = await resolveSystemAgentModelConfig({
      taskConfig: config,
      taskKey: 'topicAutoSummary',
    });
    let result: Awaited<ReturnType<typeof analyzeTopic>>;
    try {
      result = await analyzeTopic({
        db: this.db,
        model,
        provider,
        summary: historySummary?.slice(-MAX_PREVIOUS_SUMMARY_CHARS) || undefined,
        topicId,
        transcript,
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      if (isClientOnlyModelError(error)) return { analyzed: false, reason: 'no-executor' };
      throw error;
    }
    if (!result) {
      log('topic %s: analysis by %s/%s returned no usable result', topicId, provider, model);
      return { analyzed: false, reason: 'invalid-output' };
    }

    const analysisModel = new TopicAnalysisModel(this.db, this.userId, this.workspaceId);
    const saved = await analysisModel.save({
      lastMessageId: latest.id,
      lastMessageUpdatedAt: latest.updatedAt,
      result,
      topicId,
      usage: await analysisModel.snapshotTopicUsage(topicId),
    });
    return saved ? { analyzed: true } : { analyzed: false, reason: 'stale' };
  };

  /** Shared opt-in, ownership and visitor guards, then the bounded recent transcript. */
  private loadContext = async (
    topicId: string,
    force?: boolean,
  ): Promise<{ reason: SkipReason } | { context: TopicContext }> => {
    const settings = await new UserModel(this.db, this.userId).getUserSettings();
    const systemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;
    const config = systemAgent?.topicAutoSummary as Partial<SystemAgentItem> | undefined;
    // Opt-in, so an absent setting means disabled — the dispatch query filters on
    // the same default, and this guard also covers replays that skip dispatch.
    if (!force && config?.enabled !== true) return { reason: 'disabled' };

    const ownership = this.workspaceId
      ? eq(messages.workspaceId, this.workspaceId)
      : eq(messages.userId, this.userId);
    const topicOwnership = this.workspaceId
      ? eq(topics.workspaceId, this.workspaceId)
      : eq(topics.userId, this.userId);
    const [topic] = await this.db
      .select({ historySummary: topics.historySummary, senderId: topics.senderId })
      .from(topics)
      .where(and(eq(topics.id, topicId), topicOwnership, notTrashed(topics.isDeleted)))
      .limit(1);
    // The job may have been queued before the topic was moved to trash. Stop
    // before loading child messages or resolving a billable model when the
    // live-topic fence no longer finds it.
    if (!topic) {
      log('skipping missing or trashed topic %s', topicId);
      return { reason: 'stale' };
    }
    // Share-visitor topics are creator-billed only through the share spend
    // gate. Reject them defensively before any LLM call — the dispatch query
    // and TopicSummaryModel.updateSummaryIfCurrent both filter them out, this
    // guard covers replays / direct callers that skip the dispatch path.
    if (topic.senderId) {
      log(
        'skipping share-visitor topic %s: visitor turns are outside the auto-summary scope',
        topicId,
      );
      return { reason: 'disabled' };
    }
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
    if (!latest) return { reason: 'empty' };

    const transcript = recent
      .reverse()
      .map(
        ({ content, role }) =>
          `${role.toUpperCase()}: ${(content ?? '').slice(0, MAX_MESSAGE_CHARS)}`,
      )
      .join('\n\n')
      .slice(-MAX_TRANSCRIPT_CHARS);

    return {
      context: { config, historySummary: topic.historySummary ?? null, latest, transcript },
    };
  };
}
