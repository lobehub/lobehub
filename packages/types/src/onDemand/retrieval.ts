import type { OnDemandDynamicEntry, OnDemandSource } from './types';

/**
 * Retrieval precedence. The current user message is handled outside this
 * enumeration and is always preserved verbatim, so it outranks every entry.
 */
export const ON_DEMAND_RETRIEVAL_AUTHORITIES = [
  'explicit_constraint',
  'stable_preference',
  'approved_experience',
  'memory',
  'unapproved_suggestion',
] as const;

export type OnDemandRetrievalAuthority = (typeof ON_DEMAND_RETRIEVAL_AUTHORITIES)[number];

export const ON_DEMAND_RETRIEVAL_AUTHORITY_RANK: Readonly<
  Record<OnDemandRetrievalAuthority, number>
> = Object.freeze({
  explicit_constraint: 5,
  stable_preference: 4,
  approved_experience: 3,
  memory: 2,
  unapproved_suggestion: 1,
});

export type OnDemandApprovalState =
  'approved' | 'hash_mismatch' | 'pending' | 'revoked' | 'stale' | 'unknown';

export type OnDemandRetrievalMode = 'lexical_fallback' | 'none' | 'vector';

export type OnDemandCandidateShare = 'agent' | 'personal' | 'public' | 'workspace';

export type OnDemandShareGate = 'allowed' | 'denied' | 'unknown';

/**
 * A candidate is returned by a storage-specific retriever (DB, cache, expertise
 * service) before shared ranking. `scope` is repeated here so the shared layer
 * cannot accidentally rank a row that the caller failed to gate.
 */
export interface OnDemandContextCandidate {
  readonly approval: {
    readonly approvedContentHash?: string;
    readonly state: OnDemandApprovalState;
  };
  readonly authority: OnDemandRetrievalAuthority;
  /** Conflict group. Only the highest-precedence member survives. */
  readonly conflictKey?: string;
  readonly content: string;
  readonly contentHash: string;
  readonly id: string;
  /** Semantic similarity when available; otherwise the shared layer uses lexical scoring. */
  readonly relevance?: number;
  readonly scope: {
    readonly agentId?: string;
    readonly ownerUserId?: string;
    readonly share: OnDemandCandidateShare;
    readonly shareGate: OnDemandShareGate;
    readonly workspaceId?: string;
  };
  readonly source: OnDemandSource;
  readonly sourceVersion?: string;
}

export interface OnDemandRetrievalScope {
  readonly agentId?: string;
  readonly userId: string;
  readonly workspaceId?: string;
}

export interface OnDemandRetrievalBatch {
  readonly candidates: readonly OnDemandContextCandidate[];
  readonly durationMs?: number;
  readonly mode?: OnDemandRetrievalMode;
}

export type OnDemandRetrievalDropReason =
  'empty' | 'higher_priority_conflict' | 'not_relevant' | 'scope_denied';

export interface OnDemandRetrievalDrop {
  readonly candidate: OnDemandContextCandidate;
  readonly reason: OnDemandRetrievalDropReason;
}

/**
 * Trace-safe retrieval telemetry. It intentionally contains only hashes,
 * counters, latency, and mode, never retrieved text.
 */
export interface OnDemandRetrievalMetadata {
  /** Entries discarded because the budget or relevance gate removed them. */
  readonly degradedCount: number;
  readonly durationMs: number;
  readonly hitCount: number;
  readonly includedCount: number;
  readonly mode: OnDemandRetrievalMode;
  readonly provenanceHash: string;
  readonly queryHash: string;
}

export interface OnDemandRetrievalResult {
  readonly dropped: readonly OnDemandRetrievalDrop[];
  readonly entries: readonly OnDemandDynamicEntry[];
  readonly metadata: Omit<OnDemandRetrievalMetadata, 'degradedCount' | 'includedCount'>;
}
