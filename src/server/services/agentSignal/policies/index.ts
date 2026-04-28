import type { AgentSignalMiddleware } from '../runtime/middleware';
import { createAnalyzeIntentPolicy } from './analyzeIntent';
import type { UserMemoryActionHandlerOptions } from './analyzeIntent/actions';
import type { CreateFeedbackDomainJudgePolicyOptions } from './analyzeIntent/feedbackDomain';
import type { CreateFeedbackSatisfactionJudgePolicyOptions } from './analyzeIntent/feedbackSatisfaction';

export * from './actionIdempotency';
export * from './analyzeIntent';
export * from './analyzeIntent/actions';
export * from './analyzeIntent/feedbackAction';
export * from './analyzeIntent/feedbackDomain';
export * from './analyzeIntent/feedbackDomainAgent';
export * from './analyzeIntent/feedbackSatisfaction';
export * from './types';

export interface CreateDefaultAgentSignalPoliciesOptions extends CreateFeedbackDomainJudgePolicyOptions {
  feedbackSatisfactionJudge?: CreateFeedbackSatisfactionJudgePolicyOptions;
  userMemory?: UserMemoryActionHandlerOptions;
}

export const createDefaultAgentSignalPolicies = (
  options: CreateDefaultAgentSignalPoliciesOptions = {},
): AgentSignalMiddleware[] => {
  return [createAnalyzeIntentPolicy(options)];
};
