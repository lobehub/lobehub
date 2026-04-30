import type {
  AgentSignalFeedbackDomainStagePayload,
  AgentSignalFeedbackDomainTarget,
  AgentSignalFeedbackSatisfactionStagePayload,
  SignalFeedbackSatisfaction,
} from '../policies/types';

/**
 * Input consumed by satisfaction classifier services.
 */
export interface SatisfactionClassifierInput {
  /**
   * Trimmed user feedback message to classify.
   */
  message: string;
  /**
   * Optional serialized runtime context captured with the source event.
   */
  serializedContext?: string;
}

/**
 * Input recorded when classifier structured output is malformed.
 */
export interface ClassifierMalformedOutputDiagnosticInput {
  /** Error thrown by the model-output parser or schema validator. */
  error: unknown;
  /** Stable reason used by the processor stop result. */
  reason: string;
  /** Runtime scope key for correlating policy-state and traces. */
  scopeKey: string;
  /** Signal id when the malformed output happened after signal creation. */
  signalId?: string;
  /** Source id for the source or current signal root. */
  sourceId?: string;
  /** Classifier stage that produced malformed structured output. */
  stage: 'domain' | 'satisfaction';
}

/**
 * Records recoverable classifier diagnostics outside the processor control path.
 */
export interface ClassifierDiagnosticsService {
  /**
   * Records malformed structured classifier output for later debugging.
   */
  recordMalformedOutput: (input: ClassifierMalformedOutputDiagnosticInput) => Promise<void>;
}

/**
 * Classifies a user message into the feedback satisfaction stage.
 */
export interface SatisfactionClassifierService {
  /**
   * Classifies one feedback message for overall satisfaction.
   *
   * Use when:
   * - A user-message source should produce one satisfaction signal
   * - The caller has already normalized the text passed to the classifier
   *
   * Expects:
   * - `input.message` is trimmed and belongs to the same source event as the context
   * - `input.serializedContext` is omitted when no context was captured
   *
   * Returns:
   * - One stage payload ready to embed in `signal.feedback.satisfaction`
   */
  classify: (
    input: SatisfactionClassifierInput,
  ) => Promise<AgentSignalFeedbackSatisfactionStagePayload>;
}

/**
 * Classifies satisfaction signals into actionable feedback domains.
 */
export interface DomainClassifierService {
  /**
   * Classifies one satisfaction signal into one or more phase-one domain targets.
   *
   * Use when:
   * - A non-neutral satisfaction signal should fan out into domain-specific signals
   * - Domain routing should remain independent from runtime signal construction
   *
   * Expects:
   * - `input.payload.result` is non-neutral before callers invoke the classifier
   * - `input.payload.message`, evidence, and reason come from the satisfaction stage
   *
   * Returns:
   * - Zero or more domain payloads for memory, none, prompt, or skill routing
   */
  classify: (
    input: SignalFeedbackSatisfaction,
  ) => Promise<Array<AgentSignalFeedbackDomainStagePayload<AgentSignalFeedbackDomainTarget>>>;
}
