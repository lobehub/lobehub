import {
  AGENT_SIGNAL_SOURCE_TYPES,
  type AgentSignalSourceVariants,
  type SourceAgentUserMessage,
} from '@lobechat/agent-signal/source';

import {
  AGENT_SIGNAL_POLICY_SIGNAL_TYPES,
  type AgentSignalFeedbackDomainConflictPolicy,
  type AgentSignalFeedbackDomainStagePayload,
  type AgentSignalFeedbackDomainTarget,
  type AgentSignalFeedbackEvidence,
  type SignalFeedbackDomainMemory,
  type SignalFeedbackDomainNone,
  type SignalFeedbackDomainPrompt,
  type SignalFeedbackDomainSkill,
  type SignalFeedbackSatisfaction,
} from '../policies/types';
import type { RuntimeProcessorContext } from '../runtime/context';
import type {
  ClassifierDiagnosticsService,
  DomainClassifierService,
  SatisfactionClassifierService,
} from '../services/classifierServices';
import { continueWith, stop } from './runtimeResults';

/**
 * Classifier dependencies used by feedback classifier processors.
 */
export interface ClassifierProcessorServices {
  /**
   * Optional diagnostics sink for recoverable malformed structured classifier output.
   */
  diagnostics?: ClassifierDiagnosticsService;
  /**
   * Optional domain classifier for routing non-neutral satisfaction signals.
   */
  domainClassifier?: DomainClassifierService;
  /**
   * Optional satisfaction classifier for classifying `agent.user.message` sources.
   */
  satisfactionClassifier?: SatisfactionClassifierService;
}

/**
 * Feedback-domain signal variants emitted by classifier processors.
 */
export type FeedbackDomainClassifierSignal =
  | SignalFeedbackDomainMemory
  | SignalFeedbackDomainNone
  | SignalFeedbackDomainPrompt
  | SignalFeedbackDomainSkill;

const isAgentUserMessageSource = (
  source: AgentSignalSourceVariants,
): source is SourceAgentUserMessage => {
  return source.sourceType === AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage;
};

const isRecordLike = (value: unknown): value is Record<PropertyKey, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isMalformedStructuredOutputError = (error: unknown) => {
  if (!isRecordLike(error)) return false;

  if (error.name === 'ZodError') return true;
  if ('issues' in error && Array.isArray(error.issues)) return true;

  return (
    typeof error.message === 'string' &&
    /structured output|schema|parse|invalid_type|validation/i.test(error.message)
  );
};

const recordMalformedOutput = async (
  diagnostics: ClassifierDiagnosticsService | undefined,
  input: Parameters<ClassifierDiagnosticsService['recordMalformedOutput']>[0],
) => {
  if (!diagnostics) {
    console.error('[AgentSignal] Malformed classifier output:', {
      error: input.error,
      reason: input.reason,
      scopeKey: input.scopeKey,
      signalId: input.signalId,
      sourceId: input.sourceId,
      stage: input.stage,
    });
    return;
  }

  try {
    await diagnostics.recordMalformedOutput(input);
  } catch (error) {
    console.error('[AgentSignal] Failed to record malformed classifier output:', error);
  }
};

const toConflictPolicy = (
  target: AgentSignalFeedbackDomainTarget,
): AgentSignalFeedbackDomainConflictPolicy => {
  switch (target) {
    case 'memory': {
      return { forbiddenWith: ['none'], mode: 'fanout', priority: 100 };
    }
    case 'none': {
      return {
        forbiddenWith: ['memory', 'prompt', 'skill'],
        mode: 'exclusive',
        priority: 0,
      };
    }
    case 'prompt': {
      return { forbiddenWith: ['memory', 'none', 'skill'], mode: 'exclusive', priority: 90 };
    }
    case 'skill': {
      return { forbiddenWith: ['none'], mode: 'fanout', priority: 80 };
    }
  }
};

const normalizeEvidence = (
  evidence: AgentSignalFeedbackDomainStagePayload<AgentSignalFeedbackDomainTarget>['evidence'],
): AgentSignalFeedbackEvidence[] => {
  return evidence.map((item) => ({
    cue: item.cue,
    excerpt: item.excerpt,
  }));
};

const resolveDomainEvidence = (
  target: AgentSignalFeedbackDomainStagePayload<AgentSignalFeedbackDomainTarget>,
  signal: SignalFeedbackSatisfaction,
) => {
  return target.evidence.length > 0 ? normalizeEvidence(target.evidence) : signal.payload.evidence;
};

const buildDomainSignal = (
  signal: SignalFeedbackSatisfaction,
  target: AgentSignalFeedbackDomainStagePayload<AgentSignalFeedbackDomainTarget>,
  timestamp: number,
): FeedbackDomainClassifierSignal => {
  switch (target.target) {
    case 'memory': {
      return {
        chain: {
          chainId: signal.chain.chainId,
          parentNodeId: signal.signalId,
          rootSourceId: signal.chain.rootSourceId,
        },
        payload: {
          agentId: signal.payload.agentId,
          confidence: target.confidence,
          conflictPolicy: toConflictPolicy('memory'),
          evidence: resolveDomainEvidence(target, signal),
          message: signal.payload.message,
          messageId: signal.payload.messageId,
          reason: target.reason,
          satisfactionResult: signal.payload.result,
          sourceHints: signal.payload.sourceHints,
          target: 'memory',
          topicId: signal.payload.topicId,
        },
        signalId: `${signal.signalId}:domain:memory`,
        signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainMemory,
        source: signal.source,
        timestamp,
      } satisfies SignalFeedbackDomainMemory;
    }
    case 'none': {
      return {
        chain: {
          chainId: signal.chain.chainId,
          parentNodeId: signal.signalId,
          rootSourceId: signal.chain.rootSourceId,
        },
        payload: {
          agentId: signal.payload.agentId,
          confidence: target.confidence,
          conflictPolicy: toConflictPolicy('none'),
          evidence: resolveDomainEvidence(target, signal),
          message: signal.payload.message,
          messageId: signal.payload.messageId,
          reason: target.reason,
          satisfactionResult: signal.payload.result,
          sourceHints: signal.payload.sourceHints,
          target: 'none',
          topicId: signal.payload.topicId,
        },
        signalId: `${signal.signalId}:domain:none`,
        signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainNone,
        source: signal.source,
        timestamp,
      } satisfies SignalFeedbackDomainNone;
    }
    case 'prompt': {
      return {
        chain: {
          chainId: signal.chain.chainId,
          parentNodeId: signal.signalId,
          rootSourceId: signal.chain.rootSourceId,
        },
        payload: {
          agentId: signal.payload.agentId,
          confidence: target.confidence,
          conflictPolicy: toConflictPolicy('prompt'),
          evidence: resolveDomainEvidence(target, signal),
          message: signal.payload.message,
          messageId: signal.payload.messageId,
          reason: target.reason,
          satisfactionResult: signal.payload.result,
          sourceHints: signal.payload.sourceHints,
          target: 'prompt',
          topicId: signal.payload.topicId,
        },
        signalId: `${signal.signalId}:domain:prompt`,
        signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainPrompt,
        source: signal.source,
        timestamp,
      } satisfies SignalFeedbackDomainPrompt;
    }
    case 'skill': {
      return {
        chain: {
          chainId: signal.chain.chainId,
          parentNodeId: signal.signalId,
          rootSourceId: signal.chain.rootSourceId,
        },
        payload: {
          agentId: signal.payload.agentId,
          confidence: target.confidence,
          conflictPolicy: toConflictPolicy('skill'),
          evidence: resolveDomainEvidence(target, signal),
          message: signal.payload.message,
          messageId: signal.payload.messageId,
          reason: target.reason,
          satisfactionResult: signal.payload.result,
          skillActionIntent: target.skillActionIntent,
          skillIntentError: target.skillIntentError,
          skillIntentConfidence: target.skillIntentConfidence,
          skillIntentExplicitness: target.skillIntentExplicitness,
          skillIntentReason: target.skillIntentReason,
          skillRoute: target.skillRoute,
          sourceHints: signal.payload.sourceHints,
          target: 'skill',
          topicId: signal.payload.topicId,
        },
        signalId: `${signal.signalId}:domain:skill`,
        signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainSkill,
        source: signal.source,
        timestamp,
      } satisfies SignalFeedbackDomainSkill;
    }
  }
};

/**
 * Classifies one supported source into a feedback satisfaction signal.
 *
 * Use when:
 * - An `agent.user.message` source should advance through satisfaction classification
 * - Source handlers need a service-independent signal construction path
 *
 * Expects:
 * - `source` may be any runtime source, but only `agent.user.message` is supported
 * - `services.satisfactionClassifier` is provided by the caller when classification is enabled
 *
 * Returns:
 * - A continue result with `signal.feedback.satisfaction`, otherwise a no-op stop result
 *
 * Triggering workflow:
 *
 * `agent.user.message`
 *   -> {@link classifySatisfaction}
 *     -> {@link SatisfactionClassifierService.classify}
 *       -> `signal.feedback.satisfaction`
 *
 * Upstream:
 * - `agent.user.message`
 *
 * Downstream:
 * - {@link SatisfactionClassifierService.classify}
 */
export const classifySatisfaction = async (
  source: AgentSignalSourceVariants,
  context: RuntimeProcessorContext,
  services: ClassifierProcessorServices,
) => {
  if (!isAgentUserMessageSource(source)) {
    return stop('unsupported satisfaction classifier source');
  }

  if (!services.satisfactionClassifier) {
    return stop('satisfaction classifier unavailable');
  }

  const message = source.payload.message.trim();
  let payload: Awaited<ReturnType<SatisfactionClassifierService['classify']>>;

  try {
    payload = await services.satisfactionClassifier.classify({
      message,
      serializedContext: source.payload.serializedContext,
    });
  } catch (error) {
    if (!isMalformedStructuredOutputError(error)) throw error;

    const reason = 'malformed satisfaction classifier output';
    await recordMalformedOutput(services.diagnostics, {
      error,
      reason,
      scopeKey: context.scopeKey,
      sourceId: source.sourceId,
      stage: 'satisfaction',
    });

    return stop(reason);
  }
  const signal: SignalFeedbackSatisfaction = {
    chain: {
      chainId: source.chain.chainId,
      parentNodeId: source.sourceId,
      rootSourceId: source.chain.rootSourceId,
    },
    payload: {
      agentId: source.payload.agentId,
      confidence: payload.confidence,
      evidence: normalizeEvidence(payload.evidence),
      message,
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
    timestamp: context.now(),
  };

  return continueWith('classified feedback satisfaction', signal);
};

/**
 * Classifies one satisfaction signal into domain fan-out signals.
 *
 * Use when:
 * - A non-neutral satisfaction signal should route to memory, prompt, or skill domains
 * - The caller needs a reusable processor before runtime dispatch conversion
 *
 * Expects:
 * - `signal.payload` contains satisfaction-stage evidence, reason, message, and result
 * - `services.domainClassifier` returns domain targets, including explicit `none`
 *
 * Returns:
 * - A continue result with domain signals, otherwise a no-op stop result
 *
 * Triggering workflow:
 *
 * `signal.feedback.satisfaction`
 *   -> {@link classifyDomain}
 *     -> {@link DomainClassifierService.classify}
 *       -> `signal.feedback.domain.*`
 *
 * Upstream:
 * - `signal.feedback.satisfaction`
 *
 * Downstream:
 * - {@link DomainClassifierService.classify}
 */
export const classifyDomain = async (
  signal: SignalFeedbackSatisfaction,
  context: RuntimeProcessorContext,
  services: ClassifierProcessorServices,
) => {
  if (signal.payload.result === 'neutral') {
    return stop('neutral feedback satisfaction');
  }

  if (!services.domainClassifier) {
    return stop('domain classifier unavailable');
  }

  let targets: Awaited<ReturnType<DomainClassifierService['classify']>>;

  try {
    targets = await services.domainClassifier.classify(signal);
  } catch (error) {
    if (!isMalformedStructuredOutputError(error)) throw error;

    const reason = 'malformed domain classifier output';
    await recordMalformedOutput(services.diagnostics, {
      error,
      reason,
      scopeKey: context.scopeKey,
      signalId: signal.signalId,
      sourceId: signal.source?.sourceId,
      stage: 'domain',
    });

    return stop(reason);
  }
  if (targets.length === 0) {
    return stop('no feedback domains classified');
  }

  const timestamp = context.now();
  const signals = targets.map((target) => buildDomainSignal(signal, target, timestamp));

  return continueWith('classified feedback domains', signals);
};
