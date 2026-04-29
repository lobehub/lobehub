import type { ToolOutcomeProcedureDeps } from '../../procedure/toolOutcome';
import { createToolOutcomeSourceHandler } from '../../procedure/toolOutcome';
import { defineAgentSignalHandlers } from '../../runtime/middleware';
import type {
  SkillManagementActionHandlerOptions,
  UserMemoryActionHandlerOptions,
} from './actions';
import { defineSkillManagementActionHandler, defineUserMemoryActionHandler } from './actions';
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
  procedure?: ToolOutcomeProcedureDeps & {
    markerReader: {
      shouldSuppress: (input: {
        domainKey: string;
        intentClass?: string;
        intentClassCandidates?: string[];
        procedureKey: string;
        scopeKey: string;
      }) => Promise<boolean>;
    };
  };
  skillManagement?: SkillManagementActionHandlerOptions;
  userMemory?: UserMemoryActionHandlerOptions;
}

export const createAnalyzeIntentPolicy = (options: CreateAnalyzeIntentPolicyOptions = {}) => {
  const feedbackDomainResolver = createFeedbackDomainResolver({
    feedbackDomainJudge: options.feedbackDomainJudge,
  });

  return defineAgentSignalHandlers([
    ...(options.procedure ? [createToolOutcomeSourceHandler(options.procedure)] : []),
    createFeedbackSatisfactionJudgeProcessor(options.feedbackSatisfactionJudge),
    createFeedbackDomainJudgeSignalHandler({
      resolveDomains: feedbackDomainResolver,
    }),
    createFeedbackActionPlannerSignalHandler({
      markerReader: options.procedure?.markerReader,
      procedure: options.procedure,
    }),
    ...(options.skillManagement
      ? [defineSkillManagementActionHandler(options.skillManagement)]
      : []),
    ...(options.userMemory ? [defineUserMemoryActionHandler(options.userMemory)] : []),
  ]);
};

export default createAnalyzeIntentPolicy;
