import type { RuntimeProcessorResult } from '@lobechat/agent-signal';
import {
  AGENT_SIGNAL_SOURCE_TYPES,
  type SourceAgentUserMessage,
} from '@lobechat/agent-signal/source';
import { DEFAULT_MINI_SYSTEM_AGENT_ITEM } from '@lobechat/const';
import type { GenerateObjectSchema } from '@lobechat/model-runtime';
import { chainAgentSignalAnalyzeIntentFeedbackSatisfaction } from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { defineSourceHandler } from '../../runtime/middleware';
import {
  AGENT_SIGNAL_POLICY_SIGNAL_TYPES,
  type AgentSignalFeedbackEvidence,
  type AgentSignalFeedbackSatisfactionStagePayload,
  type SignalFeedbackSatisfaction,
} from '../types';

const log = debug('lobe-server:agent-signal:feedback-satisfaction:agent');

const FeedbackEvidenceSchema = z.object({
  cue: z.string(),
  excerpt: z.string(),
});

const FeedbackSatisfactionStagePayloadSchema = z.object({
  confidence: z.number().min(0).max(1),
  evidence: z.array(FeedbackEvidenceSchema),
  reason: z.string(),
  result: z.enum(['neutral', 'not_satisfied', 'satisfied']),
});

type FeedbackSatisfactionStagePayloadResult = z.infer<
  typeof FeedbackSatisfactionStagePayloadSchema
>;

const FeedbackSatisfactionGenerateObjectSchema = {
  name: 'agent_signal_feedback_satisfaction',
  schema: {
    additionalProperties: false,
    properties: {
      confidence: { maximum: 1, minimum: 0, type: 'number' },
      evidence: {
        items: {
          additionalProperties: false,
          properties: {
            cue: { type: 'string' },
            excerpt: { type: 'string' },
          },
          required: ['cue', 'excerpt'],
          type: 'object',
        },
        type: 'array',
      },
      reason: { type: 'string' },
      result: { enum: ['neutral', 'not_satisfied', 'satisfied'], type: 'string' },
    },
    required: ['confidence', 'evidence', 'reason', 'result'],
    type: 'object',
  },
  strict: true,
} satisfies GenerateObjectSchema;

/**
 * One normalized satisfaction-judge input.
 */
export interface JudgeFeedbackSatisfactionParams {
  message: string;
  serializedContext?: string;
}

/**
 * Minimal interface for one satisfaction-judge agent.
 */
export interface FeedbackSatisfactionJudge {
  /**
   * Judges one feedback message for overall satisfaction only.
   *
   * Use when:
   * - One normalized feedback message needs a stage-local satisfaction result
   *
   * Expects:
   * - `message` is the raw feedback text
   * - `serializedContext` is the optional serialized execution context for the same event
   *
   * Returns:
   * - One semantic satisfaction result with confidence, evidence, and reason
   */
  judgeSatisfaction: (
    params: JudgeFeedbackSatisfactionParams,
  ) => Promise<AgentSignalFeedbackSatisfactionStagePayload>;
}

/**
 * Model configuration for the default satisfaction judge agent.
 */
export interface FeedbackSatisfactionJudgeAgentModelConfig {
  model: string;
  provider: string;
}

/**
 * Options for constructing the feedback satisfaction source handler.
 */
export interface CreateFeedbackSatisfactionJudgePolicyOptions {
  db?: LobeChatDatabase;
  judge?: FeedbackSatisfactionJudge;
  model?: string;
  provider?: string;
  userId?: string;
}

/**
 * Model-backed satisfaction judge for Agent Signal feedback analysis.
 *
 * Use when:
 * - The satisfaction stage should rely on one structured model decision
 * - The caller needs stage-local output without domain routing or action planning
 *
 * Expects:
 * - `db` and `userId` point at the same user context as the surrounding Agent Signal runtime
 *
 * Returns:
 * - One validated satisfaction result parsed from structured model output
 */
export class FeedbackSatisfactionJudgeAgentService implements FeedbackSatisfactionJudge {
  private readonly db: LobeChatDatabase;
  private readonly modelConfig: FeedbackSatisfactionJudgeAgentModelConfig;
  private readonly userId: string;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    modelConfig: Partial<FeedbackSatisfactionJudgeAgentModelConfig> = {},
  ) {
    this.db = db;
    this.userId = userId;
    this.modelConfig = {
      model: modelConfig.model ?? DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
      provider: modelConfig.provider ?? DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
    };
  }

  /**
   * Judges one feedback message for overall satisfaction only.
   *
   * Use when:
   * - Agent Signal needs semantic satisfaction analysis before domain routing
   *
   * Expects:
   * - The payload contains only the feedback message and serialized context
   *
   * Returns:
   * - One validated semantic satisfaction result
   */
  async judgeSatisfaction(
    params: JudgeFeedbackSatisfactionParams,
  ): Promise<AgentSignalFeedbackSatisfactionStagePayload> {
    const payload = chainAgentSignalAnalyzeIntentFeedbackSatisfaction(params);
    const modelRuntime = await initModelRuntimeFromDB(
      this.db,
      this.userId,
      this.modelConfig.provider,
    );

    log(
      'judgeSatisfaction model=%s provider=%s',
      this.modelConfig.model,
      this.modelConfig.provider,
    );

    const result = await modelRuntime.generateObject(
      {
        messages: payload.messages as any[],
        model: this.modelConfig.model,
        schema: FeedbackSatisfactionGenerateObjectSchema,
      },
      { metadata: { trigger: RequestTrigger.Memory } },
    );

    return FeedbackSatisfactionStagePayloadSchema.parse(result);
  }
}

const resolveJudge = (
  options: CreateFeedbackSatisfactionJudgePolicyOptions = {},
): FeedbackSatisfactionJudge => {
  if (options.judge) {
    return options.judge;
  }

  if (!options.db || !options.userId) {
    throw new TypeError(
      'Feedback satisfaction judge requires either an injected judge or both db and userId.',
    );
  }

  return new FeedbackSatisfactionJudgeAgentService(options.db, options.userId, {
    model: options.model,
    provider: options.provider,
  });
};

const normalizeEvidence = (
  evidence: FeedbackSatisfactionStagePayloadResult['evidence'],
): AgentSignalFeedbackEvidence[] => {
  return evidence.map((item) => ({
    cue: item.cue,
    excerpt: item.excerpt,
  }));
};

const buildSignal = (
  source: SourceAgentUserMessage,
  payload: FeedbackSatisfactionStagePayloadResult,
  timestamp: number,
): SignalFeedbackSatisfaction => {
  const normalizedMessage = source.payload.message.trim();

  return {
    chain: {
      chainId: source.chain.chainId,
      parentNodeId: source.sourceId,
      rootSourceId: source.chain.rootSourceId,
    },
    payload: {
      agentId: source.payload.agentId,
      confidence: payload.confidence,
      evidence: normalizeEvidence(payload.evidence),
      message: normalizedMessage,
      messageId: source.payload.messageId,
      reason: payload.reason,
      result: payload.result,
      serializedContext: source.payload.serializedContext,
      sourceHints: {
        documentPayload: source.payload.documentPayload,
        intents: source.payload.intents,
        memoryPayload: source.payload.memoryPayload,
      },
      topicId: source.payload.topicId,
    },
    signalId: `${source.sourceId}:signal:feedback-satisfaction`,
    signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackSatisfaction,
    source: {
      sourceId: source.sourceId,
      sourceType: source.sourceType,
    },
    timestamp,
  };
};

/**
 * Creates the source handler for the feedback satisfaction judge.
 *
 * Triggering workflow:
 *
 * `agent.user.message`
 *   -> {@link createFeedbackSatisfactionJudgeProcessor}
 *     -> `signal.feedback.satisfaction`
 *
 * Upstream:
 * - `agent.user.message`
 *
 * Downstream:
 * - configured {@link FeedbackSatisfactionJudge}
 */
export const createFeedbackSatisfactionJudgeProcessor = (
  options: CreateFeedbackSatisfactionJudgePolicyOptions = {},
) => {
  const judge = resolveJudge(options);

  return defineSourceHandler(
    AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage,
    `${AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage}:feedback-satisfaction-judge`,
    async (source, ctx): Promise<RuntimeProcessorResult | void> => {
      const normalizedMessage = source.payload.message.trim();
      const payload = await judge.judgeSatisfaction({
        message: normalizedMessage,
        serializedContext: source.payload.serializedContext,
      });

      return {
        signals: [
          buildSignal(source, FeedbackSatisfactionStagePayloadSchema.parse(payload), ctx.now()),
        ],
        status: 'dispatch',
      };
    },
  );
};
