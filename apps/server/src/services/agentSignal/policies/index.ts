import type { AgentSignalMiddleware } from '../runtime/middleware';
import { createScenarioPolicies } from '../scenarios/registry';
import { AGENT_SIGNAL_SCENARIO_IDS } from '../scenarios/types';
import type { CreateAnalyzeIntentPolicyOptions } from './analyzeIntent';
import type {
  SkillManagementActionHandlerOptions,
  UserMemoryActionHandlerOptions,
} from './analyzeIntent/actions';
import type { CreateFeedbackDomainJudgePolicyOptions } from './analyzeIntent/feedbackDomain';
import type { CreateFeedbackSatisfactionJudgePolicyOptions } from './analyzeIntent/feedbackSatisfaction';
import type { CreateCompletionPolicyOptions } from './completionPolicy';
import type { CreateReviewNightlyPolicyOptions } from './reviewNightly';

export * from './actionIdempotency';
export * from './analyzeIntent';
export * from './analyzeIntent/actions';
export * from './analyzeIntent/feedbackAction';
export * from './analyzeIntent/feedbackDomain';
export * from './analyzeIntent/feedbackDomainAgent';
export * from './analyzeIntent/feedbackSatisfaction';
export * from './completionPolicy';
export * from './reviewNightly';
export * from './types';

export interface CreateDefaultAgentSignalPoliciesOptions extends CreateFeedbackDomainJudgePolicyOptions {
  classifierDiagnostics?: CreateAnalyzeIntentPolicyOptions['classifierDiagnostics'];
  /** Optional callbacks invoked after agent.execution.completed for builtin self-iteration agents. */
  completion?: CreateCompletionPolicyOptions;
  feedbackSatisfactionJudge?: CreateFeedbackSatisfactionJudgePolicyOptions;
  nightlyReview?: CreateReviewNightlyPolicyOptions['nightlyReview'];
  procedure?: CreateAnalyzeIntentPolicyOptions['procedure'];
  selfFeedbackIntent?: CreateReviewNightlyPolicyOptions['selfFeedbackIntent'];
  selfReflection?: CreateReviewNightlyPolicyOptions['selfReflection'];
  skillIntentClassifier?: CreateAnalyzeIntentPolicyOptions['skillIntentClassifier'];
  skillManagement?: SkillManagementActionHandlerOptions;
  userMemory?: UserMemoryActionHandlerOptions;
}

/**
 * Creates the default Agent Signal policy stack with optional self-iteration source handlers.
 *
 * Use when:
 * - Runtime creation needs the standard analyze-intent policies
 * - Callers want to opt into nightly self-review, self-reflection, or self-feedback handlers
 *   with explicit handler options
 *
 * Expects:
 * - Optional self-iteration options are complete bundles for their source handlers
 * - Missing optional options mean the corresponding source handler is not installed
 *
 * Returns:
 * - Middleware list that installs analyze-intent policies and enabled source handlers
 */
export const createDefaultAgentSignalPolicies = (
  options: CreateDefaultAgentSignalPoliciesOptions = {},
): AgentSignalMiddleware[] => {
  return createScenarioPolicies(AGENT_SIGNAL_SCENARIO_IDS.selfIteration, options);
};
