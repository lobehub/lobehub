import type {
  AgentSignalChainRef,
  AgentSignalScope,
  AgentSignalSource,
  BaseAction,
  BaseSignal,
  SignalRef,
  SourceRef,
} from './types';

interface CreateSourceInput {
  chain?: Partial<AgentSignalChainRef>;
  payload: Record<string, unknown>;
  scope: AgentSignalScope;
  scopeKey: string;
  sourceId?: string;
  sourceType: string;
  timestamp?: number;
}

interface CreateSignalInput {
  chain?: Partial<AgentSignalChainRef>;
  payload: Record<string, unknown>;
  signalId?: string;
  signalType: string;
  source: AgentSignalSource;
  timestamp?: number;
}

interface CreateActionInput {
  actionId?: string;
  actionType: string;
  chain?: Partial<AgentSignalChainRef>;
  output?: Record<string, unknown>;
  payload: Record<string, unknown>;
  signal: BaseSignal;
  timestamp?: number;
}

let nodeSeed = 0;

const createNodeId = (kind: 'action' | 'signal' | 'source') => {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === 'function') {
    return `${kind}:${crypto.randomUUID()}`;
  }

  nodeSeed += 1;
  return `${kind}:${Date.now().toString(36)}:${nodeSeed.toString(36)}`;
};

const buildChainRef = (
  rootSourceId: string,
  overrides?: Partial<AgentSignalChainRef>,
  parentNodeId?: string,
  parentSignalId?: string,
  parentActionId?: string,
): AgentSignalChainRef => {
  return {
    ...overrides,
    chainId: overrides?.chainId ?? `chain:${rootSourceId}`,
    parentActionId: overrides?.parentActionId ?? parentActionId,
    parentNodeId: overrides?.parentNodeId ?? parentNodeId,
    parentSignalId: overrides?.parentSignalId ?? parentSignalId,
    rootSourceId,
  };
};

/** Creates a normalized source node. */
export const createSource = (input: CreateSourceInput): AgentSignalSource => {
  const sourceId = input.sourceId ?? createNodeId('source');
  const timestamp = input.timestamp ?? Date.now();

  return {
    chain: buildChainRef(sourceId, input.chain),
    payload: input.payload,
    scope: input.scope,
    scopeKey: input.scopeKey,
    sourceId,
    sourceType: input.sourceType,
    timestamp,
  };
};

/** Creates a normalized signal node from a source node. */
export const createSignal = (input: CreateSignalInput): BaseSignal => {
  const signalId = input.signalId ?? createNodeId('signal');
  const timestamp = input.timestamp ?? Date.now();
  const rootSourceId = input.source.chain.rootSourceId;

  return {
    chain: buildChainRef(rootSourceId, input.chain, input.source.sourceId),
    payload: input.payload,
    signalId,
    signalType: input.signalType,
    source: {
      sourceId: input.source.sourceId,
      sourceType: input.source.sourceType,
    } satisfies SourceRef,
    timestamp,
  };
};

/** Creates a normalized action node from a signal node. */
export const createAction = (input: CreateActionInput): BaseAction => {
  const actionId = input.actionId ?? createNodeId('action');
  const timestamp = input.timestamp ?? Date.now();
  const rootSourceId = input.signal.chain.rootSourceId;

  return {
    actionId,
    actionType: input.actionType,
    chain: buildChainRef(rootSourceId, input.chain, input.signal.signalId, input.signal.signalId),
    output: input.output,
    payload: input.payload,
    signal: {
      signalId: input.signal.signalId,
      signalType: input.signal.signalType,
    } satisfies SignalRef,
    source: input.signal.source,
    timestamp,
  };
};
