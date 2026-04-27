import { DEFAULT_MINI_SYSTEM_AGENT_ITEM } from '@lobechat/const';
import { chainAgentSignalAnalyzeIntentRoute } from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { buildGenerateObjectSchema } from '../../../../../../packages/memory-user-memory/src/utils/zod';
import type {
  AgentSignalFeedbackEvidence,
  AgentSignalFeedbackPhase1DomainTarget,
  AgentSignalFeedbackSatisfactionResult,
} from '../types';

const log = debug('lobe-server:agent-signal:feedback-domain:agent');

type FeedbackDomainJudgeTarget = AgentSignalFeedbackPhase1DomainTarget | 'none';

const DomainTargetSchema = z.object({
  confidence: z.number().min(0).max(1),
  evidence: z.array(
    z.object({
      cue: z.string(),
      excerpt: z.string(),
    }),
  ),
  reason: z.string(),
  target: z.enum(['memory', 'none', 'prompt', 'skill']),
});

const FeedbackDomainJudgeAgentResultSchema = z.object({
  targets: z.array(DomainTargetSchema).min(1).max(4),
});

export type FeedbackDomainJudgeAgentResult = z.infer<typeof FeedbackDomainJudgeAgentResultSchema>;

export interface FeedbackDomainJudgeAgentModelConfig {
  model: string;
  provider: string;
}

export interface JudgeFeedbackDomainsParams {
  evidence: AgentSignalFeedbackEvidence[];
  message: string;
  reason: string;
  result: AgentSignalFeedbackSatisfactionResult;
}

/**
 * Lightweight task-agent service for feedback domain routing.
 *
 * Use when:
 * - A satisfaction signal must be routed into one or more durable domains
 * - Agent Signal should use a model decision instead of cue-based heuristics
 *
 * Expects:
 * - `message` is one normalized user-feedback string
 * - `result`, `reason`, and `evidence` come from the upstream satisfaction stage
 *
 * Returns:
 * - One validated set of domain targets suitable for domain signal fan-out
 */
export class FeedbackDomainJudgeAgentService {
  private readonly db: LobeChatDatabase;
  private readonly modelConfig: FeedbackDomainJudgeAgentModelConfig;
  private readonly userId: string;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    modelConfig: Partial<FeedbackDomainJudgeAgentModelConfig> = {},
  ) {
    this.db = db;
    this.userId = userId;
    this.modelConfig = {
      model: modelConfig.model ?? DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
      provider: modelConfig.provider ?? DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
    };
  }

  /**
   * Routes one feedback satisfaction input into durable domains.
   *
   * Use when:
   * - The domain judge needs model-backed routing without planning final actions
   *
   * Expects:
   * - `message` already reflects the normalized feedback text
   * - `result`, `reason`, and `evidence` already reflect the upstream satisfaction lane
   *
   * Returns:
   * - One validated set of unique domain targets with confidence and rationale
   */
  async judgeDomains(params: JudgeFeedbackDomainsParams): Promise<FeedbackDomainJudgeAgentResult> {
    const payload = chainAgentSignalAnalyzeIntentRoute(params);
    const modelRuntime = await initModelRuntimeFromDB(
      this.db,
      this.userId,
      this.modelConfig.provider,
    );

    log('judgeDomains model=%s provider=%s', this.modelConfig.model, this.modelConfig.provider);

    const result = await modelRuntime.generateObject(
      {
        messages: payload.messages as any[],
        model: this.modelConfig.model,
        schema: buildGenerateObjectSchema(FeedbackDomainJudgeAgentResultSchema, {
          name: 'agent_signal_feedback_domain_route',
        }),
      },
      { metadata: { trigger: RequestTrigger.Memory } },
    );

    return FeedbackDomainJudgeAgentResultSchema.parse({
      targets: dedupeTargets(FeedbackDomainJudgeAgentResultSchema.parse(result).targets),
    });
  }
}

const dedupeTargets = (
  targets: Array<{
    confidence: number;
    evidence: Array<{ cue: string; excerpt: string }>;
    reason: string;
    target: FeedbackDomainJudgeTarget;
  }>,
) => {
  const deduped = new Map<FeedbackDomainJudgeTarget, (typeof targets)[number]>();

  for (const target of targets) {
    const current = deduped.get(target.target);

    if (!current || target.confidence > current.confidence) {
      deduped.set(target.target, target);
    }
  }

  return [...deduped.values()];
};
