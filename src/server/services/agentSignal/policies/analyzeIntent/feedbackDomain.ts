import { type BaseSignal, type RuntimeProcessorResult } from '@lobechat/agent-signal';

import type { LobeChatDatabase } from '@/database/type';

import { defineSignalHandler } from '../../runtime/middleware';
import {
  AGENT_SIGNAL_POLICY_SIGNAL_TYPES,
  type AgentSignalFeedbackDomainConflictPolicy,
  type AgentSignalFeedbackEvidence,
  type SignalFeedbackSatisfaction,
} from '../types';
import {
  type FeedbackDomainJudgeAgentModelConfig,
  type FeedbackDomainJudgeAgentResult,
  FeedbackDomainJudgeAgentService,
} from './feedbackDomainAgent';

interface FeedbackDomainJudgeResolverInput {
  chain: SignalFeedbackSatisfaction['chain'];
  feedback: Pick<
    SignalFeedbackSatisfaction['payload'],
    'confidence' | 'evidence' | 'message' | 'messageId' | 'reason' | 'result'
  >;
  source: SignalFeedbackSatisfaction['source'];
  sourceHints: SignalFeedbackSatisfaction['payload']['sourceHints'];
  topicId: SignalFeedbackSatisfaction['payload']['topicId'];
}

/**
 * Dependencies for the feedback-domain judge signal handler.
 */
export interface CreateFeedbackDomainJudgeSignalHandlerOptions {
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

const toConflictPolicy = (
  target: FeedbackDomainJudgeAgentResult['targets'][number]['target'],
): AgentSignalFeedbackDomainConflictPolicy => {
  switch (target) {
    case 'memory': {
      return { forbiddenWith: ['none'], mode: 'fanout', priority: 100 };
    }
    case 'prompt': {
      return { forbiddenWith: ['memory', 'none', 'skill'], mode: 'exclusive', priority: 90 };
    }
    case 'skill': {
      return { forbiddenWith: ['none'], mode: 'fanout', priority: 80 };
    }
    default: {
      return {
        forbiddenWith: ['memory', 'prompt', 'skill'],
        mode: 'exclusive',
        priority: 0,
      };
    }
  }
};

const toSignalType = (target: FeedbackDomainJudgeAgentResult['targets'][number]['target']) => {
  switch (target) {
    case 'memory': {
      return AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainMemory;
    }
    case 'skill': {
      return AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainSkill;
    }
    case 'prompt': {
      return AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainPrompt;
    }
    default: {
      return AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainNone;
    }
  }
};

const buildDomainSignals = (
  signal: SignalFeedbackSatisfaction,
  targets: FeedbackDomainJudgeAgentResult['targets'],
): BaseSignal[] => {
  return targets.map((target) => ({
    chain: {
      chainId: signal.chain.chainId,
      parentNodeId: signal.signalId,
      rootSourceId: signal.chain.rootSourceId,
    },
    payload: {
      agentId: signal.payload.agentId,
      confidence: target.confidence,
      conflictPolicy: toConflictPolicy(target.target),
      evidence:
        target.evidence.length > 0
          ? (target.evidence as AgentSignalFeedbackEvidence[])
          : signal.payload.evidence,
      message: signal.payload.message,
      messageId: signal.payload.messageId,
      reason: target.reason,
      satisfactionResult: signal.payload.result,
      sourceHints: signal.payload.sourceHints,
      target: target.target,
      topicId: signal.payload.topicId,
    },
    signalId: `${signal.signalId}:domain:${target.target}`,
    signalType: toSignalType(target.target),
    source: signal.source,
    timestamp: Date.now(),
  }));
};

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
    async (signal): Promise<RuntimeProcessorResult | void> => {
      if (!resolveDomains || signal.payload.result === 'neutral') {
        return;
      }

      const domainTargets = await resolveDomains({
        chain: signal.chain,
        feedback: {
          confidence: signal.payload.confidence,
          evidence: signal.payload.evidence,
          message: signal.payload.message,
          messageId: signal.payload.messageId,
          reason: signal.payload.reason,
          result: signal.payload.result,
        },
        source: signal.source,
        sourceHints: signal.payload.sourceHints,
        topicId: signal.payload.topicId,
      });

      return {
        signals: buildDomainSignals(signal, domainTargets),
        status: 'dispatch',
      };
    },
  );
};

export const createFeedbackDomainResolver = (
  options: CreateFeedbackDomainJudgePolicyOptions = {},
) => {
  return createDomainResolver(options);
};
