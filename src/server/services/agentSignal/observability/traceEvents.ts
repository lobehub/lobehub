import type {
  AgentSignalSource,
  BaseAction,
  BaseSignal,
  ExecutorResult,
} from '@lobechat/agent-signal';

export interface AgentSignalTraceEvent {
  [key: string]: unknown;
  data: Record<string, unknown>;
  timestamp: number;
  type:
    | 'agent_signal.action'
    | 'agent_signal.result'
    | 'agent_signal.signal'
    | 'agent_signal.source';
}

/** Formats AgentSignal nodes into compact tracing events. */
export const toAgentSignalTraceEvents = (input: {
  actions: BaseAction[];
  results: ExecutorResult[];
  signals: BaseSignal[];
  source: AgentSignalSource;
}): AgentSignalTraceEvent[] => {
  const sourceEvent: AgentSignalTraceEvent = {
    data: {
      chainId: input.source.chain.chainId,
      rootSourceId: input.source.chain.rootSourceId,
      scopeKey: input.source.scopeKey,
      sourceId: input.source.sourceId,
      sourceType: input.source.sourceType,
    },
    timestamp: input.source.timestamp,
    type: 'agent_signal.source',
  };

  const signalEvents: AgentSignalTraceEvent[] = input.signals.map((signal) => ({
    data: {
      parentNodeId: signal.chain.parentNodeId,
      signalId: signal.signalId,
      signalType: signal.signalType,
      sourceId: signal.source.sourceId,
    },
    timestamp: signal.timestamp,
    type: 'agent_signal.signal',
  }));

  const actionEvents: AgentSignalTraceEvent[] = input.actions.map((action) => ({
    data: {
      actionId: action.actionId,
      actionType: action.actionType,
      parentNodeId: action.chain.parentNodeId,
      signalId: action.signal.signalId,
    },
    timestamp: action.timestamp,
    type: 'agent_signal.action',
  }));

  const resultEvents: AgentSignalTraceEvent[] = input.results.map((result, index) => ({
    data: {
      actionId: result.actionId,
      attemptCurrent: result.attempt.current,
      attemptStatus: result.attempt.status,
      detail: result.detail,
      errorCode: result.status === 'failed' ? result.error.code : undefined,
      runId: 'runId' in result.attempt ? result.attempt.runId : undefined,
      status: result.status,
    },
    timestamp:
      input.actions.find((action) => action.actionId === result.actionId)?.timestamp ??
      input.source.timestamp + input.signals.length + input.actions.length + index + 1,
    type: 'agent_signal.result',
  }));

  return [sourceEvent, ...signalEvents, ...actionEvents, ...resultEvents];
};
