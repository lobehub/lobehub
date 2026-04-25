import type { AgentSignalMiddleware } from '../../runtime/middleware';

export interface CreateDefaultAgentSignalPoliciesOptions {}

/**
 * Creates the default policy installers for one Phase 1 AgentSignal runtime.
 *
 * The default milestone bundle stays intentionally narrow:
 * - `userFeedbackAnalysis` remains enabled for memory-targeted feedback planning
 * - `nudge.memory` remains enabled as the threshold-based runtime policy
 * - `selfReflectionAnalysis` is not part of the default runtime path for Phase 1
 */
export const createDefaultAgentSignalPolicies = (
  options: CreateDefaultAgentSignalPoliciesOptions = {},
): AgentSignalMiddleware[] => {
  void options;
  return [];
};
