import type { AgentSignalMiddleware } from '../runtime/middleware';
import type { CreateAnalyzeIntentPolicyOptions } from './analyzeIntent';
import { createAnalyzeIntentPolicy } from './analyzeIntent';
import type {
  SkillManagementActionHandlerOptions,
  UserMemoryActionHandlerOptions,
} from './analyzeIntent/actions';
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
  procedure?: CreateAnalyzeIntentPolicyOptions['procedure'];
  skillManagement?: SkillManagementActionHandlerOptions;
  userMemory?: UserMemoryActionHandlerOptions;
}

export const createDefaultAgentSignalPolicies = (
  options: CreateDefaultAgentSignalPoliciesOptions = {},
): AgentSignalMiddleware[] => {
  return [createAnalyzeIntentPolicy(options)];
};
