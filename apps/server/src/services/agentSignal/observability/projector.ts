import type {
  AgentSignalSource,
  BaseAction,
  BaseSignal,
  ExecutorResult,
} from '@lobechat/agent-signal';

import type {
  AgentSignalObservabilityProjection,
  AgentSignalObservabilityProjectionInput,
  AgentSignalTelemetryRecord,
  AgentSignalTraceEdge,
  AgentSignalTraceHandlerRun,
} from './types';

const readStringField = (payload: Record<string, unknown>, key: string) => {
  return typeof payload[key] === 'string' ? payload[key] : undefined;
};

const resolveSignalDomain = (signalType: string) => {
  const segments = signalType.split('.');

  return segments.length > 2 ? segments.slice(1, -1).join('.') : signalType;
};

const resolveSignalOutcome = (signalType: string) => {
  return signalType.split('.').at(-1) ?? signalType;
};

const buildStatusBreakdown = (results: ExecutorResult[]) => ({
  applied: results.filter((result) => result.status === 'applied').length,
  failed: results.filter((result) => result.status === 'failed').length,
  skipped: results.filter((result) => result.status === 'skipped').length,
});

const buildAttemptBreakdown = (results: ExecutorResult[]) => ({
  failed: results.filter((result) => result.attempt.status === 'failed').length,
  retriableFailures: results.filter(
    (result) => result.status === 'failed' && result.error.retriable === true,
  ).length,
  skipped: results.filter((result) => result.attempt.status === 'skipped').length,
  succeeded: results.filter((result) => result.attempt.status === 'succeeded').length,
  total: results.length,
});

const buildTraceEdges = (
  source: AgentSignalSource,
  signals: BaseSignal[],
  actions: BaseAction[],
  results: ExecutorResult[],
): AgentSignalTraceEdge[] => {
  const edges: AgentSignalTraceEdge[] = [];

  for (const signal of signals) {
    edges.push({
      from: signal.chain.parentNodeId ?? source.sourceId,
      relation: 'produced',
      to: signal.signalId,
    });
  }

  for (const action of actions) {
    edges.push({
      from: action.chain.parentNodeId ?? action.signal.signalId,
      relation: 'triggered',
      to: action.actionId,
    });
  }

  for (const result of results) {
    edges.push({
      from: result.actionId,
      relation: 'resulted-in',
      to: `${result.actionId}:result`,
    });
  }

  return edges;
};

const buildCompressedSignals = (signals: BaseSignal[]) => {
  const compressedSignals = new Map<
    string,
    {
      outcomes: Record<string, number>;
      total: number;
    }
  >();

  for (const signal of signals) {
    const domain = resolveSignalDomain(signal.signalType);
    const outcome = resolveSignalOutcome(signal.signalType);
    const current = compressedSignals.get(domain) ?? { outcomes: {}, total: 0 };

    current.total += 1;
    current.outcomes[outcome] = (current.outcomes[outcome] ?? 0) + 1;
    compressedSignals.set(domain, current);
  }

  return Object.fromEntries(compressedSignals.entries());
};

const buildHandlerRuns = (
  actions: BaseAction[],
  results: ExecutorResult[],
): AgentSignalTraceHandlerRun[] => {
  return actions.flatMap((action) => {
    const result = results.find((candidate) => candidate.actionId === action.actionId);
    if (!result) return [];

    const status: AgentSignalTraceHandlerRun['status'] =
      result.status === 'failed' ? 'failed' : result.status === 'skipped' ? 'skipped' : 'ok';

    return [
      {
        attempt: result.attempt,
        durationMs:
          result.attempt.completedAt !== undefined
            ? result.attempt.completedAt - result.attempt.startedAt
            : undefined,
        error:
          result.status === 'failed'
            ? {
                code: result.error.code,
                message: result.error.message,
              }
            : undefined,
        handlerType: action.actionType,
        id: `${action.actionId}:attempt:${result.attempt.current}`,
        inputRefIds: [action.signal.signalId],
        outputRefIds: [`${action.actionId}:result`],
        reasoning: result.detail,
        startedAt: new Date(result.attempt.startedAt).toISOString(),
        status,
      },
    ];
  });
};

const buildTelemetryRecord = (
  input: AgentSignalObservabilityProjectionInput,
): AgentSignalTelemetryRecord => {
  const { actions, results, signals, source } = input;
  const chainId = source.chain.chainId ?? source.chain.rootSourceId;
  const finalAction = actions.at(-1);
  const finalResult = finalAction
    ? results.find((result) => result.actionId === finalAction.actionId)
    : undefined;
  const signalDomains = [
    ...new Set(signals.map((signal) => resolveSignalDomain(signal.signalType))),
  ];
  const signalOutcomes = signals.map((signal) => resolveSignalOutcome(signal.signalType));
  const sourcePayload = source.payload as Record<string, unknown>;

  return {
    agentId: readStringField(sourcePayload, 'agentId'),
    chainId,
    conclusionChain: {
      compressedSignals: buildCompressedSignals(signals),
      dominantPath: [
        source.sourceType,
        ...signals.map((signal) => signal.signalType),
        ...(finalAction ? [finalAction.actionType] : []),
      ],
      finalReason:
        finalResult?.status === 'failed' ? finalResult.error.message : finalResult?.detail,
    },
    createdAt: new Date(source.timestamp).toISOString(),
    finalActionId: finalAction?.actionId,
    finalActionType: finalAction?.actionType,
    finalStatus: finalResult?.status,
    id: `agent-signal:${source.sourceId}`,
    operationId: readStringField(sourcePayload, 'operationId'),
    rootSourceId: source.chain.rootSourceId,
    scopeKey: source.scopeKey,
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    summary: {
      attemptBreakdown: buildAttemptBreakdown(results),
      domains: signalDomains,
      outcomes: signalOutcomes,
      statusBreakdown: buildStatusBreakdown(results),
      totalActions: actions.length,
      totalSignals: signals.length,
    },
    topicId: readStringField(sourcePayload, 'topicId'),
  };
};

/** Projects one AgentSignal chain into compact telemetry and expanded trace artifacts. */
export const projectAgentSignalObservability = (
  input: AgentSignalObservabilityProjectionInput,
): AgentSignalObservabilityProjection => {
  const { actions, results, signals, source } = input;
  const sourcePayload = source.payload as Record<string, unknown>;

  return {
    envelope: {
      actions,
      chainId: source.chain.chainId ?? source.chain.rootSourceId,
      edges: buildTraceEdges(source, signals, actions, results),
      handlerRuns: buildHandlerRuns(actions, results),
      metadata: {
        agentId: readStringField(sourcePayload, 'agentId'),
        operationId: readStringField(sourcePayload, 'operationId'),
        scopeKey: source.scopeKey,
        topicId: readStringField(sourcePayload, 'topicId'),
      },
      rootSourceId: source.chain.rootSourceId,
      results,
      signals,
      source,
      traceId: readStringField(sourcePayload, 'operationId'),
      version: 1,
    },
    record: buildTelemetryRecord(input),
  };
};
