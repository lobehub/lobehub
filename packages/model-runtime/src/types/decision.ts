import type { ModelUsage } from '@lobechat/types';

import type { ModelPricingContext } from './pricing';

export type DecisionJsonValue =
  string | number | boolean | null | DecisionJsonValue[] | { [key: string]: DecisionJsonValue };

/** Plain text or structured JSON, as accepted for `state`, `instructions`, and criteria. */
export type DecisionContent = string | DecisionJsonValue[] | { [key: string]: DecisionJsonValue };

/**
 * Asks how likely a yes/no proposition is to be true.
 * Sent as a System One `noul` question.
 */
export interface DecisionBooleanQuestion {
  /** Guidance for when the proposition is true and when it is false; `instructions` may suffice. */
  criteria?: { false: DecisionContent; true: DecisionContent };
  instructions: DecisionContent;
  type: 'boolean';
}

/**
 * Asks the model to pick exactly one option from a caller-defined set.
 */
export interface DecisionChoiceQuestion {
  /** Option key → guidance describing when to pick it, or `null` when the key is self-explanatory. */
  criteria: Record<string, DecisionContent | null>;
  instructions: DecisionContent;
  type: 'choice';
}

/**
 * Asks the model to place the state on an ordered rubric.
 */
export interface DecisionScoreQuestion {
  /** Rubric level descriptions ordered from lowest to highest; level indices start at 0. */
  criteria: DecisionContent[];
  instructions: DecisionContent;
  type: 'score';
}

export type DecisionQuestion =
  DecisionBooleanQuestion | DecisionChoiceQuestion | DecisionScoreQuestion;

export type DecisionQuestions = Record<string, DecisionQuestion>;

/**
 * Typed questions about one shared state, answered with probabilities instead of generated text.
 *
 * The shape follows the System One request (named questions + criteria) used by TypeSafe,
 * OpenRouter, and vLLM Semantic Router, with the vendor term `noul` renamed to `boolean`.
 * @see https://openrouter.ai/docs/api/api-reference/systemone/submit-a-system-one-request
 */
export interface DecisionPayload<Q extends DecisionQuestions = DecisionQuestions> {
  model: string;
  /** Question name → question. Names come back as the keys of `answers`. */
  questions: Q;
  /** The content every question is evaluated against. */
  state: DecisionContent;
}

export interface DecisionBooleanAnswer {
  /** Probability (0–1) that the proposition is true. */
  probability: number;
  type: 'boolean';
}

export interface DecisionChoiceAnswer<K extends string = string> {
  choice: K;
  /**
   * Provider-defined concentration of `probabilities`. It is not the probability of being
   * correct, so do not threshold it like a boolean probability.
   */
  confidence?: number;
  /**
   * Option key → probability, one entry per requested option. Omitted when the provider does
   * not report a distribution; when present it always covers every option.
   */
  probabilities?: Record<K, number>;
  type: 'choice';
}

export interface DecisionScoreAnswer {
  confidence?: number;
  /**
   * Probability per rubric level, in the same order as the requested `criteria`. Omitted when the
   * provider does not report a distribution; when present it always covers every level.
   */
  probabilities?: number[];
  /** Probability-weighted mean of the zero-based level index; it may fall between levels. */
  score: number;
  type: 'score';
}

/**
 * The model declined this question. Other questions in the same call may still be answered,
 * so this is an answer rather than an error and never triggers a route fallback.
 */
export interface DecisionRefusalAnswer {
  reason?: string;
  type: 'refusal';
}

export type DecisionAnswer<Q extends DecisionQuestion = DecisionQuestion> =
  | DecisionRefusalAnswer
  | (Q extends DecisionBooleanQuestion
      ? DecisionBooleanAnswer
      : Q extends DecisionChoiceQuestion
        ? DecisionChoiceAnswer<Extract<keyof Q['criteria'], string>>
        : DecisionScoreAnswer);

export interface DecisionResponse<Q extends DecisionQuestions = DecisionQuestions> {
  answers: { [K in keyof Q]: DecisionAnswer<Q[K]> };
  id?: string;
  /** Model that actually served the request, possibly a dated version of the requested id. */
  model: string;
  /** Upstream provider that served the request, when reported. */
  provider?: string;
  /** Provider-reported token usage, with `cost` when the model has pricing. */
  usage?: ModelUsage;
}

export interface DecisionOptions {
  headers?: Record<string, string>;
  /** Metadata passed to hooks (billing, tracing, route attempts), e.g. `trigger`. */
  metadata?: Record<string, unknown>;
  /**
   * Receives the USD charge the upstream provider reported for this call (OpenRouter
   * `usage.cost`). Server-side only: it is kept out of `DecisionResponse` and never replaces the
   * model-bank `usage.cost`, matching chat's `OnFinishData.providerReportedCost`.
   */
  onProviderReportedCost?: (cost: number) => void | Promise<void>;
  /**
   * Receives the provider-reported token usage (with `cost` when the model has pricing)
   * after a successful decision.
   */
  onUsage?: (usage: ModelUsage) => void | Promise<void>;
  pricingContext?: ModelPricingContext;
  signal?: AbortSignal;
  /**
   * userId for the request
   */
  user?: string;
}
