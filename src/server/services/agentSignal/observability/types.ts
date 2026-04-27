import type {
  AgentSignalSource,
  BaseAction,
  BaseSignal,
  ExecutorResult,
} from '@lobechat/agent-signal';

/** Describes the compact telemetry record for one AgentSignal chain. */
export interface AgentSignalTelemetryRecord {
  agentId?: string;
  chainId: string;
  conclusionChain: {
    /** Squashed signal family and outcome summary for compact display and filtering. */
    compressedSignals: Record<string, unknown>;
    /** Dominant compact path from source to the most meaningful terminal action. */
    dominantPath: string[];
    /** Final reasoning summary for compact display. */
    finalReason?: string;
  };
  createdAt: string;
  durationMs?: number;
  expandedRef?: {
    /** External raw detail pointer, typically S3. */
    s3Key?: string;
    version: 1;
  };
  finalActionId?: string;
  finalActionType?: string;
  finalStatus?: 'applied' | 'failed' | 'skipped';
  id: string;
  operationId?: string;
  peerAgentIds?: string[];
  rootSourceId: string;
  scopeKey: string;
  sourceId: string;
  sourceType: string;
  summary: {
    /** Attempt lifecycle summary across all executed actions in the chain. */
    attemptBreakdown: {
      failed: number;
      retriableFailures: number;
      skipped: number;
      succeeded: number;
      total: number;
    };
    /** Logical signal families that appeared in this chain. */
    domains: string[];
    /** Final or intermediate business outcomes that appeared in this chain. */
    outcomes: string[];
    statusBreakdown: {
      applied: number;
      failed: number;
      skipped: number;
    };
    totalActions: number;
    totalSignals: number;
  };
  topicId?: string;
  traceId?: string;
}

/** Carries lightweight metadata copied into the raw trace envelope. */
export interface AgentSignalTraceMetadata {
  agentId?: string;
  operationId?: string;
  scopeKey?: string;
  topicId?: string;
}

/** Describes one directed causal link between two AgentSignal trace nodes. */
export interface AgentSignalTraceEdge {
  from: string;
  relation: 'linked' | 'produced' | 'resulted-in' | 'triggered';
  to: string;
}

/** Describes one handler execution summary inside a trace envelope. */
export interface AgentSignalTraceHandlerRun {
  /** Attempt metadata for the leaf action execution. */
  attempt?: ExecutorResult['attempt'];
  durationMs?: number;
  error?: {
    code?: string;
    message: string;
  };
  /** Handler or microagent family identifier. */
  handlerType: string;
  /** Handler execution record id. */
  id: string;
  /** Direct node refs that were consumed. */
  inputRefIds: string[];
  /** Direct node refs that were produced. */
  outputRefIds: string[];
  /** Optional lightweight reasoning summary for debugging. */
  reasoning?: string;
  startedAt: string;
  status: 'failed' | 'ok' | 'skipped';
}

/** Describes the expanded raw chain detail used for replay and drilldown. */
export interface AgentSignalTraceEnvelope {
  actions: BaseAction[];
  chainId: string;
  edges: AgentSignalTraceEdge[];
  handlerRuns: AgentSignalTraceHandlerRun[];
  metadata?: AgentSignalTraceMetadata;
  results: ExecutorResult[];
  rootSourceId: string;
  signals: BaseSignal[];
  source: AgentSignalSource;
  traceId?: string;
  version: 1;
}

/** Carries the summary and detail views for one projected chain. */
export interface AgentSignalObservabilityProjection {
  envelope: AgentSignalTraceEnvelope;
  record: AgentSignalTelemetryRecord;
}

/** Carries the runtime slice needed to project one AgentSignal chain. */
export interface AgentSignalObservabilityProjectionInput {
  actions: BaseAction[];
  results: ExecutorResult[];
  signals: BaseSignal[];
  source: AgentSignalSource;
}
