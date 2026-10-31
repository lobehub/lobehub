/**
 * Native Memory inputs for an eval attempt. Each collection is validated
 * against its corresponding memory-user-memory input schema on the server.
 * Owner ids and vectors are deliberately not part of this transport contract.
 */
export interface EvalMemoryFixture {
  activities?: Record<string, unknown>[];
  contexts?: Record<string, unknown>[];
  experiences?: Record<string, unknown>[];
  identities?: Record<string, unknown>[];
  persona?: { narrative: string; tagline?: string };
  preferences?: Record<string, unknown>[];
  /**
   * ISO 8601 instant the seeded rows were "remembered". Memory writes stamp
   * the wall clock, but `timeIntent` filters by that clock, so a case that
   * tells the Agent a fixed session date must pin its fixture rows to it.
   */
  seededAt?: string;
}

/**
 * Which attempt's Memory the Memory tool and persona injection read and
 * write: the attempt's own store, never the caller's memories. Server-authored
 * when the attempt starts; never a tool argument.
 */
export interface EvalMemoryReference {
  fixtureHash: string;
  runId: string;
  /** A pass@k attempt is one thread; a topic-level attempt owns its sub-agent threads. */
  threadId?: string;
  topicId: string;
}

export type EvalMemoryLayer =
  'activity' | 'context' | 'experience' | 'identity' | 'persona' | 'preference';

/** One Memory entry of an attempt: seeded from the case fixture, or written by the Agent. */
export interface EvalMemoryEntry {
  /** ISO 8601; the fixture's `seededAt` for seeded rows, the wall clock for the Agent's writes. */
  capturedAt: string;
  details?: string | null;
  id: string;
  layer: EvalMemoryLayer;
  memoryCategory?: string | null;
  memoryType?: string | null;
  /** The layer-specific part of the entry (`withPreference`, `withContext`, …; the persona text). */
  payload: Record<string, unknown>;
  /** Set when the Agent removed the entry (identities only); kept as evidence. */
  removedReason?: string | null;
  source: 'agent' | 'fixture';
  summary?: string | null;
  tags?: string[] | null;
  title?: string | null;
}

/** The attempt's Memory at the end of the attempt, retained as eval evidence. */
export interface EvalMemorySnapshot {
  attemptId: string;
  entries: EvalMemoryEntry[];
  fixtureHash: string;
}
