import type { RuntimeProcessorResult } from '@lobechat/agent-signal';

import type { LobeChatDatabase } from '@/database/type';

import { classifyDomain, transitionToSignals } from '../../processors';
import { defineSignalHandler } from '../../runtime/middleware';
import type { ClassifierDiagnosticsService, DomainClassifierService } from '../../services';
import { AGENT_SIGNAL_POLICY_SIGNAL_TYPES, type SignalFeedbackSatisfaction } from '../types';
import {
  type FeedbackDomainJudgeAgentModelConfig,
  type FeedbackDomainJudgeAgentResult,
  FeedbackDomainJudgeAgentService,
} from './feedbackDomainAgent';

interface FeedbackDomainJudgeResolverInput {
  chain: SignalFeedbackSatisfaction['chain'];
  feedback: Pick<
    SignalFeedbackSatisfaction['payload'],
    'confidence' | 'evidence' | 'message' | 'messageId' | 'reason' | 'result' | 'serializedContext'
  >;
  source: SignalFeedbackSatisfaction['source'];
  sourceHints: SignalFeedbackSatisfaction['payload']['sourceHints'];
  topicId: SignalFeedbackSatisfaction['payload']['topicId'];
}

/**
 * Dependencies for the feedback-domain judge signal handler.
 */
export interface CreateFeedbackDomainJudgeSignalHandlerOptions {
  /** Optional diagnostics sink for malformed structured classifier output. */
  classifierDiagnostics?: ClassifierDiagnosticsService;
  resolveDomains?: (
    input: FeedbackDomainJudgeResolverInput,
  ) => Promise<FeedbackDomainJudgeAgentResult['targets']>;
}

/**
 * Factory options for the feedback-domain task agent.
 */
export interface CreateFeedbackDomainJudgePolicyOptions {
  feedbackDomainJudge?: Partial<FeedbackDomainJudgeAgentModelConfig> & {
    db: LobeChatDatabase;
    userId: string;
  };
}

const createDomainResolver = (
  options: CreateFeedbackDomainJudgePolicyOptions = {},
): CreateFeedbackDomainJudgeSignalHandlerOptions['resolveDomains'] => {
  const runtimeDeps = options.feedbackDomainJudge;

  if (!runtimeDeps) return undefined;

  return async (signal) => {
    const agent = new FeedbackDomainJudgeAgentService(
      runtimeDeps.db,
      runtimeDeps.userId,
      runtimeDeps,
    );

    return (
      await agent.judgeDomains({
        evidence: signal.feedback.evidence,
        message: signal.feedback.message,
        reason: signal.feedback.reason,
        result: signal.feedback.result,
        serializedContext: signal.feedback.serializedContext,
      })
    ).targets;
  };
};

/**
 * Creates the signal handler for routing satisfaction signals into domain signals.
 *
 * Triggering workflow:
 *
 * {@link createFeedbackSatisfactionJudgeProcessor}
 *   -> `signal.feedback.satisfaction`
 *     -> {@link createFeedbackDomainJudgeSignalHandler}
 *
 * Upstream:
 * - {@link createFeedbackSatisfactionJudgeProcessor}
 *
 * Downstream:
 * - `signal.feedback.domain.memory`
 * - `signal.feedback.domain.prompt`
 * - `signal.feedback.domain.skill`
 * - `signal.feedback.domain.none`
 */
export const createFeedbackDomainJudgeSignalHandler = (
  options: CreateFeedbackDomainJudgeSignalHandlerOptions = {},
) => {
  const resolveDomains = options.resolveDomains;

  return defineSignalHandler(
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackSatisfaction,
    'signal.feedback-domain-judge',
    async (signal, ctx): Promise<RuntimeProcessorResult | void> => {
      const classifier: DomainClassifierService | undefined = resolveDomains
        ? {
            async classify(input) {
              const targets = await resolveDomains({
                chain: input.chain,
                feedback: {
                  confidence: input.payload.confidence,
                  evidence: input.payload.evidence,
                  message: input.payload.message,
                  messageId: input.payload.messageId,
                  reason: input.payload.reason,
                  result: input.payload.result,
                  serializedContext: input.payload.serializedContext,
                },
                source: input.source,
                sourceHints: input.payload.sourceHints,
                topicId: input.payload.topicId,
              });

              return targets;
            },
          }
        : undefined;
      const result = await classifyDomain(signal, ctx, {
        diagnostics: options.classifierDiagnostics,
        domainClassifier: classifier,
      });

      if (result.type === 'continue') {
        return transitionToSignals(result.value, {
          maxSignals: 4,
          reason: result.reason,
        }).result;
      }

      if (result.reason === 'neutral feedback satisfaction') {
        return;
      }

      if (result.reason === 'domain classifier unavailable') {
        return;
      }

      return result.result;
    },
  );
};

export const createFeedbackDomainResolver = (
  options: CreateFeedbackDomainJudgePolicyOptions = {},
) => {
  return createDomainResolver(options);
};
