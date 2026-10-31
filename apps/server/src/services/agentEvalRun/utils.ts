import type { EvalCaseEnvironment, EvalTestCaseMetadata } from '@lobechat/types';
import debug from 'debug';

import type { EvalRuntimeContext } from '@/server/services/agentRuntime/types';

/** Round cost to at most 6 decimal places to avoid floating-point noise */
export const roundCost = (v: number): number => Math.round(v * 1e6) / 1e6;

export const getEvalContextParams = (
  envPrompt?: string,
  environment?: EvalCaseEnvironment,
  caseId?: string,
) => {
  const mergedEnvPrompt =
    [envPrompt, environment?.envPrompt].filter(Boolean).join('\n\n') || undefined;
  const evalRuntime: EvalRuntimeContext | undefined =
    caseId || environment?.toolForwarding
      ? { ...(caseId && { caseId }), toolForwarding: environment?.toolForwarding }
      : undefined;

  return {
    ...(mergedEnvPrompt && { evalContext: { envPrompt: mergedEnvPrompt } }),
    ...(evalRuntime && { evalRuntime }),
  };
};

export const getCaseId = (metadata?: EvalTestCaseMetadata | null) => metadata?.caseId;

export const log = debug('lobe-server:eval-run-service');
