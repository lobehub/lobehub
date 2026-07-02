import type { AgentSignalHandlerDefinition, AgentSignalMiddleware } from '../../runtime/middleware';
import { defineAgentSignalHandlers } from '../../runtime/middleware';
import type { CreateSelfFeedbackIntentSourceHandlerDependencies } from '../../services/selfIteration/feedback/handler';
import { createSelfFeedbackIntentSourcePolicyHandler } from '../../services/selfIteration/feedback/handler';
import type { CreateSelfReflectionSourceHandlerDependencies } from '../../services/selfIteration/reflection/handler';
import { createSelfReflectionSourcePolicyHandler } from '../../services/selfIteration/reflection/handler';
import type { CreateNightlyReviewSourceHandlerDependencies } from '../../services/selfIteration/review/handler';
import { createNightlyReviewSourcePolicyHandler } from '../../services/selfIteration/review/handler';

const createOptionalSourceHandler = <TOptions>(
  options: TOptions | undefined,
  create: (options: TOptions) => AgentSignalHandlerDefinition,
) => (options ? [create(options)] : []);

/**
 * Options for composing review-nightly self-iteration source handlers.
 */
export interface CreateReviewNightlyPolicyOptions {
  /** Optional nightly review source handler options. */
  nightlyReview?: CreateNightlyReviewSourceHandlerDependencies;
  /** Optional self-feedback intent source handler options. */
  selfFeedbackIntent?: CreateSelfFeedbackIntentSourceHandlerDependencies;
  /** Optional self-reflection source handler options. */
  selfReflection?: CreateSelfReflectionSourceHandlerDependencies;
}

/**
 * Creates the Agent Signal policy slice for deferred self-iteration reviews.
 *
 * Use when:
 * - Runtime creation wants to install nightly review source handlers
 * - Runtime creation wants self-reflection or self-feedback intent handlers in the same domain
 *
 * Expects:
 * - Each optional handler option bundle is complete for its corresponding source handler
 * - Missing optional bundles mean that source handler is intentionally not installed
 *
 * Returns:
 * - Zero or one middleware that registers all enabled review-nightly source handlers
 */
export const createReviewNightlyPolicy = (
  options: CreateReviewNightlyPolicyOptions = {},
): AgentSignalMiddleware[] => {
  const handlers = [
    ...createOptionalSourceHandler(options.nightlyReview, createNightlyReviewSourcePolicyHandler),
    ...createOptionalSourceHandler(options.selfReflection, createSelfReflectionSourcePolicyHandler),
    ...createOptionalSourceHandler(
      options.selfFeedbackIntent,
      createSelfFeedbackIntentSourcePolicyHandler,
    ),
  ];

  return handlers.length > 0 ? [defineAgentSignalHandlers(handlers)] : [];
};

export * from '../../services/selfIteration/feedback/handler';
export * from '../../services/selfIteration/reflection/handler';
export * from '../../services/selfIteration/review/handler';
