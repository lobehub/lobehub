import type {
  AgentSignalScope,
  AgentSignalSource,
  BaseAction,
  BaseSignal,
  ExecutorResult,
  RuntimeConcludeProcessorResult,
  RuntimeProcessorResult,
  RuntimeScheduleProcessorResult,
  RuntimeWaitProcessorResult,
} from '@lobechat/agent-signal';
import { AGENT_SIGNAL_TYPES, createSource } from '@lobechat/agent-signal';

import {
  createRuntimeProcessorContext,
  type RuntimeBackend,
  type RuntimeNode,
  type RuntimeProcessorContext,
} from './context';
import { resolveRuntimeScopeKey } from './scope';

/** One generalized source emission accepted by {@link AgentSignalScheduler}. */
export interface AgentSignalSourceInput {
  payload: Record<string, unknown>;
  scope: AgentSignalScope;
  sourceId?: string;
  sourceType: string;
  timestamp?: number;
}

/** Runtime handler contract for one queueable semantic node. */
export interface AgentSignalSchedulerHandler<TNode extends RuntimeNode = RuntimeNode> {
  handle: (
    input: TNode,
    context: RuntimeProcessorContext,
  ) => Promise<AgentSignalSchedulerHandlerResult | void> | AgentSignalSchedulerHandlerResult | void;
  id: string;
}

/** Handler results accepted by the generalized runtime host. */
export type AgentSignalSchedulerHandlerResult = ExecutorResult | RuntimeProcessorResult;

/** Registry contract used by the generalized runtime host. */
export interface AgentSignalSchedulerRegistry<TNode extends RuntimeNode = RuntimeNode> {
  match: (type: string) => Array<AgentSignalSchedulerHandler<TNode>>;
  register: (
    type: string,
    entry: AgentSignalSchedulerHandler<TNode>,
  ) => AgentSignalSchedulerRegistry<TNode>;
}

/** Scheduler dependencies for the generalized runtime host. */
export interface AgentSignalSchedulerDeps {
  actionRegistry: AgentSignalSchedulerRegistry<BaseAction>;
  backend: RuntimeBackend;
  signalRegistry: AgentSignalSchedulerRegistry<BaseSignal>;
  sourceRegistry: AgentSignalSchedulerRegistry<AgentSignalSource>;
}

/** Terminal result returned by the generalized runtime host. */
export type AgentSignalSchedulerEmitResult =
  | AgentSignalSchedulerCompletedResult
  | RuntimeConcludeProcessorResult
  | RuntimeScheduleProcessorResult
  | RuntimeWaitProcessorResult;

/** Trace captured during one completed runtime pass. */
export interface AgentSignalSchedulerTrace {
  actions: BaseAction[];
  results: ExecutorResult[];
  signals: BaseSignal[];
  source: AgentSignalSource;
}

/**
 * Completed runtime result including the captured execution trace.
 */
export interface AgentSignalSchedulerCompletedResult {
  status: 'completed';
  trace: AgentSignalSchedulerTrace;
}

const isSourceNode = (node: RuntimeNode): node is AgentSignalSource => {
  return 'sourceId' in node;
};

const isSignalNode = (node: RuntimeNode): node is BaseSignal => {
  return 'signalId' in node;
};

const isExecutorResult = (value: unknown): value is ExecutorResult => {
  if (!value || typeof value !== 'object') return false;
  if (!('status' in value) || !('actionId' in value)) return false;

  return value.status === 'applied' || value.status === 'failed' || value.status === 'skipped';
};

const buildExecutionSignal = (action: BaseAction, result: ExecutorResult): BaseSignal => {
  const baseSignal = {
    chain: {
      chainId: action.chain.chainId,
      parentActionId: action.actionId,
      parentNodeId: action.actionId,
      rootSourceId: action.chain.rootSourceId,
    },
    signalId: `${action.actionId}:result`,
    source: action.source,
    timestamp: Date.now(),
  };

  if (result.status === 'failed') {
    return {
      ...baseSignal,
      payload: {
        actionId: action.actionId,
        actionType: action.actionType,
        attempt: result.attempt,
        detail: result.detail,
        error: result.error,
      },
      signalType: AGENT_SIGNAL_TYPES.actionFailed,
    };
  }

  return {
    ...baseSignal,
    payload: {
      actionId: action.actionId,
      actionType: action.actionType,
      attempt: result.attempt,
      detail: result.detail,
    },
    signalType:
      result.status === 'applied'
        ? AGENT_SIGNAL_TYPES.actionApplied
        : AGENT_SIGNAL_TYPES.actionSkipped,
  };
};

/** Queue-driven scheduler for one already-assembled AgentSignal runtime. */
export class AgentSignalScheduler {
  constructor(private readonly deps: AgentSignalSchedulerDeps) {}

  async emit(input: AgentSignalSourceInput): Promise<AgentSignalSchedulerEmitResult> {
    const scopeKey = resolveRuntimeScopeKey(input.scope);
    const source = createSource({
      payload: input.payload,
      scope: input.scope,
      scopeKey,
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      timestamp: input.timestamp,
    });

    return this.processSource(source, scopeKey);
  }

  /** Processes one pre-normalized source node through the runtime host. */
  async emitNormalized(source: AgentSignalSource): Promise<AgentSignalSchedulerEmitResult> {
    return this.processSource(source, source.scopeKey);
  }

  private async processSource(
    source: AgentSignalSource,
    scopeKey: string,
  ): Promise<AgentSignalSchedulerEmitResult> {
    let terminalResult: AgentSignalSchedulerEmitResult | undefined;
    const trace: AgentSignalSchedulerTrace = {
      actions: [],
      results: [],
      signals: [],
      source,
    };

    await this.deps.backend.appendToWaypoint(scopeKey, source);

    const pending = await this.deps.backend.loadWaypoint(scopeKey);
    const queue: RuntimeNode[] = [pending.trigger ?? source];

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) continue;
      this.captureNode(node, trace);
      const runtimeResult = await this.dispatchNode(node, scopeKey, queue, trace);

      if (runtimeResult && !terminalResult) {
        terminalResult = runtimeResult;
      }
    }

    return terminalResult ?? ({ status: 'completed', trace } as const);
  }

  private async applyResult(
    node: RuntimeNode,
    result: AgentSignalSchedulerHandlerResult | void,
    queue: RuntimeNode[],
    trace: AgentSignalSchedulerTrace,
  ): Promise<AgentSignalSchedulerEmitResult | undefined> {
    if (!result) return;
    if (isExecutorResult(result)) {
      if ('actionId' in node) {
        trace.results.push(result);
        queue.push(buildExecutionSignal(node, result));
      }

      return;
    }

    switch (result.status) {
      case 'conclude':
      case 'schedule':
      case 'wait': {
        return result;
      }
      case 'dispatch': {
        if (result.signals) {
          queue.push(...result.signals);
        }

        if (result.actions) {
          queue.push(...result.actions);
        }

        return;
      }
    }
  }

  private captureNode(node: RuntimeNode, trace: AgentSignalSchedulerTrace) {
    if (isSourceNode(node)) return;
    if (isSignalNode(node)) {
      trace.signals.push(node);
      return;
    }

    trace.actions.push(node);
  }

  private resolveNodeTime(node: RuntimeNode) {
    return 'timestamp' in node && typeof node.timestamp === 'number' ? node.timestamp : Date.now();
  }

  private async dispatchHandlers<TNode extends RuntimeNode>(
    handlers: Array<AgentSignalSchedulerHandler<TNode>>,
    node: TNode,
    scopeKey: string,
    queue: RuntimeNode[],
    trace: AgentSignalSchedulerTrace,
  ) {
    let terminalResult: AgentSignalSchedulerEmitResult | undefined;
    const now = this.resolveNodeTime(node);

    for (const handler of handlers) {
      const result = await handler.handle(
        node,
        createRuntimeProcessorContext({
          backend: this.deps.backend,
          now: () => now,
          scopeKey,
        }),
      );
      const runtimeResult = await this.applyResult(node, result, queue, trace);

      if (runtimeResult && !terminalResult) {
        terminalResult = runtimeResult;
      }
    }

    return terminalResult;
  }

  private async dispatchNode(
    node: RuntimeNode,
    scopeKey: string,
    queue: RuntimeNode[],
    trace: AgentSignalSchedulerTrace,
  ) {
    if (isSourceNode(node)) {
      return this.dispatchHandlers(
        this.deps.sourceRegistry.match(node.sourceType),
        node,
        scopeKey,
        queue,
        trace,
      );
    }

    if (isSignalNode(node)) {
      return this.dispatchHandlers(
        this.deps.signalRegistry.match(node.signalType),
        node,
        scopeKey,
        queue,
        trace,
      );
    }

    return this.dispatchHandlers(
      this.deps.actionRegistry.match(node.actionType),
      node,
      scopeKey,
      queue,
      trace,
    );
  }
}
