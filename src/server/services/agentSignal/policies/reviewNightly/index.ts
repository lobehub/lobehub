import type { AgentSignalHandlerDefinition, AgentSignalMiddleware } from '../../runtime/middleware';
import { defineAgentSignalHandlers } from '../../runtime/middleware';
import type { CreateNightlyReviewSourceHandlerDependencies } from './nightlyReview';
import { createNightlyReviewSourcePolicyHandler } from './nightlyReview';
import type { CreateSelfIterationIntentSourceHandlerDependencies } from './selfIterationIntent';
import { createSelfIterationIntentSourcePolicyHandler } from './selfIterationIntent';
import type { CreateSelfReflectionSourceHandlerDependencies } from './selfReflection';
import { createSelfReflectionSourcePolicyHandler } from './selfReflection';

const createOptionalSourceHandler = <TOptions>(
  options: TOptions | undefined,
  create: (options: TOptions) => AgentSignalHandlerDefinition,
) => (options ? [create(options)] : []);

/**
 * Options for composing review-nightly maintenance source handlers.
 */
export interface CreateReviewNightlyPolicyOptions {
  /** Optional nightly review source handler options. */
  nightlyReview?: CreateNightlyReviewSourceHandlerDependencies;
  /** Optional self-iteration intent source handler options. */
  selfIterationIntent?: CreateSelfIterationIntentSourceHandlerDependencies;
  /** Optional self-reflection source handler options. */
  selfReflection?: CreateSelfReflectionSourceHandlerDependencies;
}

/**
 * Creates the Agent Signal policy slice for deferred maintenance reviews.
 *
 * Use when:
 * - Runtime creation wants to install nightly review source handlers
 * - Runtime creation wants self-reflection or self-iteration intent handlers in the same domain
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
      options.selfIterationIntent,
      createSelfIterationIntentSourcePolicyHandler,
    ),
  ];

  return handlers.length > 0 ? [defineAgentSignalHandlers(handlers)] : [];
};

export * from './nightlyReview';
export * from './selfIterationIntent';
export * from './selfReflection';
