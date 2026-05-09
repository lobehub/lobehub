export type AgentSignalProcedureStatus = 'failed' | 'handled' | 'observed' | 'suppressed';
export type AgentSignalProcedureMarkerType = 'accumulated' | 'handled' | 'suppressed';
export type AgentSignalProcedureReceiptStatus =
  | 'acknowledged'
  | 'failed'
  | 'handled'
  | 'processing'
  | 'queued'
  | 'skipped'
  | 'updated';

/**
 * Related object attached to a compact procedure fact.
 */
export interface AgentSignalProcedureRelatedObject {
  /** Stable object id in the owning subsystem. */
  objectId: string;
  /** Object family such as memory, document, skill, message, or tool. */
  objectType: string;
  /** Relationship between the procedure and the object. */
  relation?: string;
}

/**
 * Runtime graph ids referenced by one compact procedure record.
 */
export interface AgentSignalProcedureRecordRefs {
  /** Agent Signal action node ids caused by the procedure. */
  actionIds?: string[];
  /** Agent Signal executor result node ids caused by the procedure. */
  resultIds?: string[];
  /** Agent Signal signal node ids caused by the procedure. */
  signalIds?: string[];
  /** Agent Signal source node ids caused by the procedure. */
  sourceIds?: string[];
}

/**
 * Compact policy fact projected from existing Agent Signal runtime nodes.
 *
 * This is not a source, signal, action, executor result, or trace graph. Store node ids and
 * summaries here; keep raw payloads in the existing runtime graph and observability projection.
 */
export interface AgentSignalProcedureRecord {
  /** Accumulator role used by domain bucket scoring. */
  accumulatorRole?: 'candidate' | 'context' | 'ignored';
  /** Cheap deterministic score delta for weak-signal accumulation. */
  cheapScoreDelta?: number;
  /** Millisecond timestamp when the record was created. */
  createdAt: number;
  /** Fine-grained domain key such as `memory:user-preference`. */
  domainKey: string;
  /** Stable record id for policy-state fields and receipts. */
  id: string;
  /** Optional intent class inferred by the direct tool or planner. */
  intentClass?: string;
  /** Runtime graph references related to this compact projection. */
  refs: AgentSignalProcedureRecordRefs;
  /** Related domain objects changed or observed by this procedure. */
  relatedObjects?: AgentSignalProcedureRelatedObject[];
  /** Runtime scope shared by direct outcomes and planner suppression. */
  scopeKey: string;
  /** Compact procedure status used for marker and receipt projections. */
  status: AgentSignalProcedureStatus;
  /** Human-readable compact summary for context continuity. */
  summary?: string;
}

/**
 * Planner and accumulator gate stored as policy state.
 *
 * Markers answer whether a procedure has already been handled, suppressed, or accumulated. They are
 * not user-visible receipts and not full history.
 */
export interface AgentSignalProcedureMarker {
  /** Action id associated with the marker when the planner created one. */
  actionId?: string;
  /** Millisecond timestamp when the marker was created. */
  createdAt: number;
  /** Fine-grained domain key guarded by the marker. */
  domainKey: string;
  /** Millisecond timestamp after which the marker is inactive. */
  expiresAt: number;
  /** Optional intent class guarded by the marker. */
  intentClass?: string;
  /** Fully qualified policy-state key for this marker. */
  key: string;
  /** Marker behavior category. */
  markerType: AgentSignalProcedureMarkerType;
  /** Receipt id associated with this marker. */
  receiptId?: string;
  /** Record id associated with this marker. */
  recordId?: string;
  /** Runtime scope shared by direct outcomes and planner suppression. */
  scopeKey: string;
  /** Signal id associated with this marker. */
  signalId?: string;
  /** Source id associated with this marker. */
  sourceId?: string;
}

/**
 * Status projection for context injection and compact message metadata.
 *
 * Receipts never drive planner suppression; marker state is the planner truth.
 */
export interface AgentSignalProcedureReceipt {
  /** Millisecond timestamp when the receipt was created. */
  createdAt: number;
  /** Fine-grained domain key represented by the receipt. */
  domainKey: string;
  /** Stable receipt id. */
  id: string;
  /** Optional intent class represented by the receipt. */
  intentClass?: string;
  /** Message id associated with the receipt when available. */
  messageId?: string;
  /** Procedure record ids summarized by the receipt. */
  recordIds?: string[];
  /** Related domain objects changed or observed by this procedure. */
  relatedObjects?: AgentSignalProcedureRelatedObject[];
  /** Runtime scope shared by direct outcomes and planner suppression. */
  scopeKey: string;
  /** Source id associated with the receipt. */
  sourceId?: string;
  /** User-visible status of the compact procedure projection. */
  status: AgentSignalProcedureReceiptStatus;
  /** Compact summary suitable for context injection. */
  summary: string;
  /** Millisecond timestamp when the receipt was last updated. */
  updatedAt: number;
}

/**
 * Compact message metadata envelope for recent Agent Signal procedure receipts.
 */
export interface MessageAgentSignalProcedureReceiptEnvelope {
  /** Fine-grained domain key represented by the receipt. */
  domainKey: string;
  /** Stable receipt id. */
  id: string;
  /** Message-visible status excluding acknowledged internal state. */
  status: Exclude<AgentSignalProcedureReceiptStatus, 'acknowledged'>;
  /** Compact summary suitable for context continuity. */
  summary: string;
  /** Millisecond timestamp when the receipt was last updated. */
  updatedAt: number;
}

/**
 * Domain bucket state for accumulated procedure records.
 */
export interface DomainProcedureAccumulatorState {
  /** Stable bucket key combining scope and coarse domain. */
  bucketKey: string;
  /** Deterministic cheap score used before batch scoring. */
  cheapScore: number;
  /** Coarse domain bucket such as memory, skill, or document. */
  domain: 'document' | 'memory' | 'skill' | string;
  /** Millisecond timestamp for first record observed in the bucket. */
  firstSeenAt: number;
  /** Last deterministic batch score result. */
  lastBatch?: DomainProcedureBatchScore;
  /** Millisecond timestamp for last emitted score signal. */
  lastEmittedAt?: number;
  /** Millisecond timestamp for last scoring attempt. */
  lastScoredAt?: number;
  /** Last scoring error message when batch scoring failed. */
  lastScoringError?: string;
  /** Millisecond timestamp for newest record observed in the bucket. */
  lastSeenAt: number;
  /** Number of appended records. */
  recordCount: number;
  /** Record ids contained in the bucket. */
  recordIds: string[];
  /** Runtime scope shared by direct outcomes and planner suppression. */
  scopeKey: string;
  /** Bucket schema version. */
  version: '1';
}

/**
 * Deterministic score output for one accumulated procedure bucket.
 */
export interface DomainProcedureBatchScore {
  /** Aggregate score across item scores. */
  aggregateScore: number;
  /** Confidence in the deterministic P0 score. */
  confidence: number;
  /** Per-record scoring details. */
  itemScores: Array<{
    reasons: string[];
    recordId: string;
    score: number;
    suggestedAction?: 'handle' | 'ignore' | 'maintain' | 'review' | 'summarize';
  }>;
  /** Millisecond timestamp for scoring. */
  scoredAt: number;
  /** Suggested aggregate actions for the bucket. */
  suggestedActions: string[];
}
