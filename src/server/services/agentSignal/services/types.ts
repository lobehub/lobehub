import type { DeferredSkillCandidate } from '../policies/analyzeIntent/skillCandidate';
import type { ProcedureAccumulatorScoreResult } from '../procedure/accumulators/procedure';
import type { AgentSignalProcedureInspectionSnapshot } from '../procedure/inspector';
import type { ProcedureMarkerKeyInput } from '../procedure/keys';
import type {
  AgentSignalProcedureMarker,
  AgentSignalProcedureReceipt,
  AgentSignalProcedureRecord,
} from '../procedure/types';

/**
 * Input for checking active handled procedure markers.
 */
export interface ProcedureMarkerSuppressInput extends ProcedureMarkerKeyInput {
  /** Ordered intent-class fallbacks used to find compatible handled markers. */
  intentClassCandidates?: string[];
}

/**
 * Business input for writing an accumulated procedure marker.
 */
export interface ProcedureAccumulatedMarkerInput {
  /** Domain bucket that accumulated enough evidence. */
  domainKey: string;
  /** Procedure intent class represented by the accumulated score. */
  intentClass?: string;
  /** Stable key linking the accumulated marker to a procedure source. */
  procedureKey: string;
  /** Procedure record id that caused this accumulated marker. */
  recordId: string;
  /** Runtime scope where the marker is visible. */
  scopeKey: string;
  /** Scored procedure signal id emitted for this accumulated marker. */
  signalId: string;
  /** Source id that produced the accumulated marker. */
  sourceId?: string;
}

/**
 * Facade for procedure policy-state persistence and inspection.
 *
 * This service is the data-plane boundary for procedure records, accumulators, receipts, markers,
 * and snapshots. It keeps policy handlers from depending on individual storage helper functions.
 */
export interface ProcedureStateService {
  /** Procedure accumulator operations for weak-signal bucket storage and scoring. */
  accumulators: {
    /** Appends one record into the scope/domain accumulator bucket. */
    append: (record: AgentSignalProcedureRecord) => Promise<void>;
    /** Appends one record and returns a score result when the bucket crosses scoring gates. */
    appendAndScore: (
      record: AgentSignalProcedureRecord,
    ) => Promise<ProcedureAccumulatorScoreResult | undefined>;
  };
  /** Read-only procedure inspection operations. */
  inspect: {
    /** Reads records, markers, receipts, and accumulator fields for one runtime scope. */
    scope: (scopeKey: string) => Promise<AgentSignalProcedureInspectionSnapshot>;
  };
  /** Procedure marker operations for write-side gates and suppression reads. */
  markers: {
    /** Checks whether an active handled marker suppresses the current procedure candidate. */
    shouldSuppress: (input: ProcedureMarkerSuppressInput) => Promise<boolean>;
    /** Writes one accumulated marker using facade-owned expiry semantics. */
    writeAccumulated: (input: ProcedureAccumulatedMarkerInput) => Promise<void>;
    /** Writes one marker and its scope-local marker index entry. */
    write: (marker: AgentSignalProcedureMarker) => Promise<void>;
  };
  /** Scope-local procedure receipt operations. */
  receipts: {
    /** Appends one compact procedure receipt field. */
    append: (receipt: AgentSignalProcedureReceipt) => Promise<void>;
  };
  /** Scope-local procedure record operations. */
  records: {
    /** Writes one compact procedure record field. */
    write: (record: AgentSignalProcedureRecord) => Promise<void>;
  };
  /** Deferred skill-candidate operations between user and completion analysis stages. */
  skillCandidates?: {
    /** Reads one deferred skill candidate by source id. */
    read: (input: {
      scopeKey: string;
      sourceId: string;
    }) => Promise<DeferredSkillCandidate | undefined>;
    /** Writes one deferred skill candidate with facade-owned expiry semantics. */
    write: (candidate: DeferredSkillCandidate) => Promise<void>;
  };
}
