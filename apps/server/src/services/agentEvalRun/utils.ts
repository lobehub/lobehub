import type {
  EvalCaseEnvironment,
  EvalConnectorSnapshots,
  EvalTestCaseMetadata,
} from '@lobechat/types';
import debug from 'debug';

import type { EvalRuntimeContext } from '@/server/services/agentRuntime/types';

import { EVAL_INFRASTRUCTURE_TOOLS } from './constants';

export { EVAL_INFRASTRUCTURE_TOOLS } from './constants';

/** Round cost to at most 6 decimal places to avoid floating-point noise */
export const roundCost = (v: number): number => Math.round(v * 1e6) / 1e6;

/**
 * Identity of one eval attempt: a case run, or one pass@k thread of it. It is
 * derived, not stored, so a resumed attempt keeps it and a retried case (new
 * topic) gets a new one. Sub-agents inherit it; mocks key their session on it.
 */
export const getEvalAttemptId = ({
  runId,
  threadId,
  topicId,
}: {
  runId: string;
  threadId?: string | null;
  topicId: string;
}) => [runId, topicId, threadId].filter(Boolean).join('_');

/**
 * The tool allowlist of a case that declares its own agent tools: those
 * plugins, every mocked service and every forwarded tool, plus the
 * infrastructure tools. `undefined` when the case declares no tool list, so a
 * run on a real Agent keeps that Agent's tools.
 */
export const getEvalAllowedTools = (environment?: EvalCaseEnvironment): string[] | undefined => {
  const declared = environment?.agent?.plugins;
  const requiredMocks = [
    ...(environment?.mock?.services ?? []),
    ...Object.keys(environment?.toolForwarding ?? {}),
  ];
  const boundIdentifiers = Object.keys(environment?.connectorBindings ?? {}).filter(
    (identifier) =>
      (!environment?.mock && !environment?.toolForwarding) || requiredMocks.includes(identifier),
  );
  if (
    !Array.isArray(declared) &&
    !environment?.connectorBindings &&
    !environment?.mock?.services?.length &&
    !environment?.toolForwarding
  )
    return undefined;
  return [
    ...new Set([
      ...(declared ?? []),
      ...boundIdentifiers,
      ...(environment?.mock?.services ?? []),
      ...Object.keys(environment?.toolForwarding ?? {}),
      ...EVAL_INFRASTRUCTURE_TOOLS,
    ]),
  ];
};

export const getEvalContextParams = (
  envPrompt?: string,
  environment?: EvalCaseEnvironment,
  caseId?: string,
  memory?: EvalRuntimeContext['memory'],
  attemptId?: string,
  connectorSnapshots?: EvalConnectorSnapshots,
) => {
  const mergedEnvPrompt =
    [envPrompt, environment?.envPrompt].filter(Boolean).join('\n\n') || undefined;
  const evalContext =
    mergedEnvPrompt || environment?.sessionDate
      ? {
          ...(mergedEnvPrompt && { envPrompt: mergedEnvPrompt }),
          ...(environment?.sessionDate && {
            sessionDate: environment.sessionDate,
            ...(environment.timezone && { timezone: environment.timezone }),
          }),
        }
      : undefined;
  const allowedTools = getEvalAllowedTools(environment);
  const evalRuntime: EvalRuntimeContext | undefined =
    caseId || connectorSnapshots || memory || attemptId || allowedTools
      ? {
          ...(allowedTools && { allowedTools }),
          ...(attemptId && { attemptId }),
          ...(caseId && { caseId }),
          ...(memory && { memory }),
          ...(connectorSnapshots && { connectorSnapshots }),
        }
      : undefined;

  return {
    ...(evalContext && { evalContext }),
    ...(evalRuntime && { evalRuntime }),
  };
};

export const getCaseId = (metadata?: EvalTestCaseMetadata | null) => metadata?.caseId;

export const log = debug('lobe-server:eval-run-service');
