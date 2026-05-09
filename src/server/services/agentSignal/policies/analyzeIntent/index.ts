import type { ToolOutcomeProcedureDeps } from '../../procedure/toolOutcome';
import { createToolOutcomeSourceHandler } from '../../procedure/toolOutcome';
import { defineAgentSignalHandlers } from '../../runtime/middleware';
import type { ClassifierDiagnosticsService } from '../../services/classifierServices';
import type { ProcedureStateService } from '../../services/types';
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
  createSkillIntentClassifier,
} from './feedbackDomain';
import type { CreateFeedbackSatisfactionJudgePolicyOptions } from './feedbackSatisfaction';
import { createFeedbackSatisfactionJudgeProcessor } from './feedbackSatisfaction';

interface AnalyzeIntentProcedureOptions extends ToolOutcomeProcedureDeps {
  /** Reads handled procedure markers for feedback-action suppression. */
  markerReader: {
    /** Checks whether an active marker suppresses the current procedure candidate. */
    shouldSuppress: (input: {
      domainKey: string;
      intentClass?: string;
      intentClassCandidates?: string[];
      procedureKey: string;
      scopeKey: string;
    }) => Promise<boolean>;
  };
  /** Composed procedure service bundle for migrated procedure processors. */
  procedureState?: ProcedureStateService;
}

/**
 * Options for composing the analyze-intent agent signal policy.
 */
export interface CreateAnalyzeIntentPolicyOptions {
  /** Optional diagnostics sink for recoverable classifier structured-output failures. */
  classifierDiagnostics?: ClassifierDiagnosticsService;
  /** Optional domain judge dependency used by feedback domain classification. */
  feedbackDomainJudge?: CreateFeedbackDomainJudgePolicyOptions['feedbackDomainJudge'];
  /** Optional satisfaction judge dependencies used by feedback satisfaction classification. */
  feedbackSatisfactionJudge?: CreateFeedbackSatisfactionJudgePolicyOptions;
  /** Optional procedure dependencies shared by tool-outcome projection and action planning. */
  procedure?: AnalyzeIntentProcedureOptions;
  /** Optional skill intent classifier dependencies used after skill-domain routing. */
  skillIntentClassifier?: CreateFeedbackDomainJudgePolicyOptions['skillIntentClassifier'];
  /** Optional skill-management action handler dependencies. */
  skillManagement?: SkillManagementActionHandlerOptions;
  /** Optional user-memory action handler dependencies. */
  userMemory?: UserMemoryActionHandlerOptions;
}

export const createAnalyzeIntentPolicy = (options: CreateAnalyzeIntentPolicyOptions = {}) => {
  const feedbackDomainResolver = createFeedbackDomainResolver({
    feedbackDomainJudge: options.feedbackDomainJudge,
  });
  const skillIntentClassifier = createSkillIntentClassifier({
    skillIntentClassifier: options.skillIntentClassifier,
  });

  return defineAgentSignalHandlers([
    ...(options.procedure ? [createToolOutcomeSourceHandler(options.procedure)] : []),
    createFeedbackSatisfactionJudgeProcessor({
      ...options.feedbackSatisfactionJudge,
      classifierDiagnostics:
        options.feedbackSatisfactionJudge?.classifierDiagnostics ?? options.classifierDiagnostics,
    }),
    createFeedbackDomainJudgeSignalHandler({
      classifierDiagnostics: options.classifierDiagnostics,
      resolveDomains: feedbackDomainResolver,
      skillIntentClassifier,
    }),
    createFeedbackActionPlannerSignalHandler({
      markerReader: options.procedure?.markerReader,
      procedure: options.procedure,
    }),
    ...(options.skillManagement
      ? [
          defineSkillManagementActionHandler({
            ...options.skillManagement,
            procedureState:
              options.skillManagement.procedureState ?? options.procedure?.procedureState,
          }),
        ]
      : []),
    ...(options.userMemory ? [defineUserMemoryActionHandler(options.userMemory)] : []),
  ]);
};

export default createAnalyzeIntentPolicy;
