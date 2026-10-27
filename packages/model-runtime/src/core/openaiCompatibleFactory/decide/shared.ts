import type {
  DecisionChoiceQuestion,
  DecisionPayload,
  DecisionQuestion,
  DecisionResponse,
  DecisionScoreQuestion,
} from '../../../types';

/** A response that does not answer what was asked; mapped to `ProviderBizError`. */
export class InvalidDecisionResponseError extends Error {}

export type DecisionQuestionEntries = [name: string, question: DecisionQuestion][];

export interface DecisionWireUsage {
  inputTokens: number;
  outputTokens?: number;
  /** Raw provider charge, validated before it reaches `onProviderReportedCost`. */
  providerReportedCost?: unknown;
}

export interface ParsedDecisionWireResponse {
  response: Omit<DecisionResponse, 'usage'>;
  usage?: DecisionWireUsage;
}

/** Translates the provider-neutral decision protocol to one endpoint's wire format. */
export interface DecisionWireAdapter {
  buildBody: (params: {
    payload: DecisionPayload;
    questionEntries: DecisionQuestionEntries;
    /** Model id sent upstream; may differ from `payload.model` after id mapping. */
    requestModel: string;
    user?: string;
  }) => Record<string, unknown>;
  /**
   * Maps the raw response back to answers keyed by question name.
   * Throws {@link InvalidDecisionResponseError} when it is malformed or incomplete.
   */
  parseResponse: (
    raw: unknown,
    questionEntries: DecisionQuestionEntries,
  ) => ParsedDecisionWireResponse;
}

export const assertRequestedChoice = (
  name: string,
  question: DecisionChoiceQuestion,
  choice: unknown,
): string => {
  // Own keys only: option names such as `toString` would otherwise hit the prototype.
  if (typeof choice !== 'string' || !Object.hasOwn(question.criteria, choice)) {
    throw new InvalidDecisionResponseError(
      `Question "${name}" chose "${String(choice)}", which is not a requested option`,
    );
  }
  return choice;
};

/**
 * The distribution is optional upstream, but a partial one would read a gap as zero, so every
 * requested option must be reported.
 */
export const pickChoiceProbabilities = (
  name: string,
  question: DecisionChoiceQuestion,
  getProbability: (option: string) => number | undefined,
): Record<string, number> =>
  Object.fromEntries(
    Object.keys(question.criteria).map((option) => {
      const probability = getProbability(option);
      if (probability === undefined) {
        throw new InvalidDecisionResponseError(
          `Question "${name}" has no probability for option "${option}"`,
        );
      }
      return [option, probability];
    }),
  );

/** A missing level probability is not evidence of zero, so reject rather than fill it. */
export const pickScoreProbabilities = (
  name: string,
  question: DecisionScoreQuestion,
  getProbability: (level: number) => number | undefined,
): number[] =>
  question.criteria.map((_, level) => {
    const probability = getProbability(level);
    if (probability === undefined) {
      throw new InvalidDecisionResponseError(
        `Question "${name}" has no probability for score level ${level}`,
      );
    }
    return probability;
  });
