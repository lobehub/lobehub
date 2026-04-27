import { defineAgentSignalHandlers } from '../../runtime/middleware';
import type { UserMemoryActionHandlerOptions } from './actions';
import { defineUserMemoryActionHandler } from './actions';
import { createFeedbackActionPlannerSignalHandler } from './feedbackAction';
import type { CreateFeedbackDomainJudgePolicyOptions } from './feedbackDomain';
import {
  createFeedbackDomainJudgeSignalHandler,
  createFeedbackDomainResolver,
} from './feedbackDomain';
import type { CreateFeedbackSatisfactionJudgePolicyOptions } from './feedbackSatisfaction';
import { createFeedbackSatisfactionJudgeProcessor } from './feedbackSatisfaction';

export interface CreateAnalyzeIntentPolicyOptions {
  feedbackDomainJudge?: CreateFeedbackDomainJudgePolicyOptions['feedbackDomainJudge'];
  feedbackSatisfactionJudge?: CreateFeedbackSatisfactionJudgePolicyOptions;
  userMemory?: UserMemoryActionHandlerOptions;
}

export const createAnalyzeIntentPolicy = (options: CreateAnalyzeIntentPolicyOptions = {}) => {
  const feedbackDomainResolver = createFeedbackDomainResolver({
    feedbackDomainJudge: options.feedbackDomainJudge,
  });

  return defineAgentSignalHandlers([
    createFeedbackSatisfactionJudgeProcessor(options.feedbackSatisfactionJudge),
    createFeedbackDomainJudgeSignalHandler({
      resolveDomains: feedbackDomainResolver,
    }),
    createFeedbackActionPlannerSignalHandler(),
    ...(options.userMemory ? [defineUserMemoryActionHandler(options.userMemory)] : []),
  ]);
};

export default createAnalyzeIntentPolicy;
