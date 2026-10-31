import { createAnalyzeIntentPolicy } from '../policies/analyzeIntent';
import { createCompletionPolicy } from '../policies/completionPolicy';
import { createReviewNightlyPolicy } from '../policies/reviewNightly';
import { selfIterationScenarioMeta } from './meta';
import type { AgentSignalScenario } from './types';

/**
 * Memory, skill, reflection, self-feedback and nightly review. Gated by the Labs → Self-evolving
 * switch and executed out-of-band through the workflow.
 */
export const selfIterationScenario: AgentSignalScenario = {
  ...selfIterationScenarioMeta,
  createPolicies: (options) => [
    createAnalyzeIntentPolicy(options),
    ...createReviewNightlyPolicy({
      nightlyReview: options.nightlyReview,
      selfFeedbackIntent: options.selfFeedbackIntent,
      selfReflection: options.selfReflection,
    }),
    createCompletionPolicy(options.completion ?? {}),
  ],
};
