import type {
  EvalCaseEnvironment,
  EvalMockConfig,
  EvalTestCaseMetadata,
  EvalToolForwardingConfig,
} from '@lobechat/types';
import debug from 'debug';

import type { EvalRuntimeContext } from '@/server/services/agentRuntime/types';

import { getTrustedMockBaseUrl, MOCK_SERVICE_NOT_CONFIGURED } from './mockService';

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
 * Tools every attempt keeps whatever the case declares: the activator (it can
 * only activate what the pruned tool set still holds), the agent's own
 * intervention/sub-agent tool and Memory (whose scope the attempt already
 * isolates). The same ids the eval harness treated as infrastructure.
 */
export const EVAL_INFRASTRUCTURE_TOOLS = ['lobe-activator', 'lobe-agent', 'lobe-user-memory'];

/**
 * The tool allowlist of a case that declares its own agent tools: those
 * plugins, every mocked service and every forwarded tool, plus the
 * infrastructure tools. `undefined` when the case declares no tool list, so a
 * run on a real Agent keeps that Agent's tools.
 */
export const getEvalAllowedTools = (environment?: EvalCaseEnvironment): string[] | undefined => {
  const declared = environment?.agent?.plugins;
  if (!Array.isArray(declared)) return undefined;
  return [
    ...new Set([
      ...declared,
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
    caseId || environment?.toolForwarding || memory || attemptId || allowedTools
      ? {
          ...(allowedTools && { allowedTools }),
          ...(attemptId && { attemptId }),
          ...(caseId && { caseId }),
          ...(memory && { memory }),
          toolForwarding: environment?.toolForwarding,
        }
      : undefined;

  return {
    ...(evalContext && { evalContext }),
    ...(evalRuntime && { evalRuntime }),
  };
};

export const getCaseId = (metadata?: EvalTestCaseMetadata | null) => metadata?.caseId;

/**
 * The mock an attempt runs against: the deployment's trusted mock address
 * (`EVAL_TOOL_MOCK_BASE_URL`) with the benchmark's `metadata.mock` presentation
 * fields on top, overridden field by field by the dataset's. A `baseUrl` stored
 * with the benchmark or dataset is ignored: the address is never user data.
 * `undefined` when this server has no mock configured.
 */
export const getEvalMockConfig = (
  benchmark?: { metadata?: Record<string, unknown> | null } | null,
  dataset?: { metadata?: Record<string, unknown> | null } | null,
): EvalMockConfig | undefined => {
  const baseUrl = getTrustedMockBaseUrl();
  if (!baseUrl) return undefined;
  const pick = (value: unknown): Partial<EvalMockConfig> => {
    if (!value || typeof value !== 'object') return {};
    const { connectors, dataset: datasetSegment, timeoutMs } = value as Partial<EvalMockConfig>;
    return {
      ...(connectors && { connectors }),
      ...(typeof datasetSegment === 'string' && datasetSegment && { dataset: datasetSegment }),
      ...(typeof timeoutMs === 'number' && timeoutMs > 0 && { timeoutMs }),
    };
  };
  return { ...pick(benchmark?.metadata?.mock), ...pick(dataset?.metadata?.mock), baseUrl };
};

/** The mock's origin and the dataset segment its URLs carry for these cases. */
const getMockLocation = (mock: EvalMockConfig, datasetIdentifier: string) => ({
  base: mock.baseUrl.replace(/\/+$/, ''),
  dataset: encodeURIComponent(mock.dataset ?? datasetIdentifier),
});

/** The prefix every discovery URL of this mock shares, whatever the dataset. */
export const getMockDiscoveryOrigin = (mock: EvalMockConfig) =>
  `${mock.baseUrl.replace(/\/+$/, '')}/mcp/`;

/** Where LobeHub reads a mock connector's tool list (MCP streamable HTTP). */
export const getMockDiscoveryUrl = (
  mock: EvalMockConfig,
  datasetIdentifier: string,
  identifier: string,
) => {
  const { base, dataset } = getMockLocation(mock, datasetIdentifier);
  return `${base}/mcp/${dataset}/${encodeURIComponent(identifier)}`;
};

/**
 * The forwarding table an attempt runs with: one endpoint on the trusted mock
 * for every connector the case declares, in `mock.services` or as a key of its
 * `toolForwarding`. An explicit entry only contributes its `timeoutMs`; an
 * endpoint stored with the case (or an older benchmark) is never used, so a
 * run can only ever talk to the deployment's mock. A case that forwards tools
 * on a server without a mock would run them for real, so that is refused.
 */
export const resolveCaseToolForwarding = (
  environment: EvalCaseEnvironment | undefined,
  mock: EvalMockConfig | undefined,
  datasetIdentifier: string,
): EvalToolForwardingConfig | undefined => {
  const explicit = environment?.toolForwarding ?? {};
  const identifiers = [
    ...new Set([...(environment?.mock?.services ?? []), ...Object.keys(explicit)]),
  ];
  if (identifiers.length === 0) return undefined;
  if (!mock) throw new Error(MOCK_SERVICE_NOT_CONFIGURED);
  const { base, dataset } = getMockLocation(mock, datasetIdentifier);
  return Object.fromEntries(
    identifiers.map((identifier) => {
      const timeoutMs = explicit[identifier]?.timeoutMs ?? mock.timeoutMs;
      return [
        identifier,
        {
          endpoint: `${base}/tool-exec/${dataset}/${encodeURIComponent(identifier)}/exec`,
          ...(timeoutMs && { timeoutMs }),
        },
      ];
    }),
  );
};

export const withResolvedToolForwarding = (
  environment: EvalCaseEnvironment | undefined,
  mock: EvalMockConfig | undefined,
  datasetIdentifier: string,
): EvalCaseEnvironment | undefined => {
  const toolForwarding = resolveCaseToolForwarding(environment, mock, datasetIdentifier);
  if (!toolForwarding) {
    if (!environment?.toolForwarding) return environment;
    const { toolForwarding: _ignored, ...rest } = environment;
    return rest;
  }
  return { ...environment, toolForwarding };
};

export const log = debug('lobe-server:eval-run-service');
