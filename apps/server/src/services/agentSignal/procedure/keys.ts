export const PROCEDURE_MARKER_POLICY_ID = 'procedure-marker';
export const PROCEDURE_MARKER_INDEX_POLICY_ID = 'procedure-marker-index';
export const PROCEDURE_RECORDS_POLICY_ID = 'procedure-records';
export const PROCEDURE_RECEIPTS_POLICY_ID = 'procedure-receipts';
export const PROCEDURE_ACCUMULATOR_POLICY_ID = 'procedure-accumulator';

/**
 * Input for building stable procedure identity from structured ids.
 */
export interface CreateProcedureKeyInput {
  /** Message id takes priority because same-turn suppression is message-scoped. */
  messageId?: string;
  /** Operation id is used when no message id exists. */
  operationId?: string;
  /** Root source id fallback from the Agent Signal chain. */
  rootSourceId: string;
  /** Tool call id is used when message and operation ids are absent. */
  toolCallId?: string;
}

/**
 * Creates a stable procedure key from structured ids only.
 *
 * Before:
 * - `{ messageId: "m1", rootSourceId: "source_1" }`
 *
 * After:
 * - `"message:m1"`
 */
export const createProcedureKey = (input: CreateProcedureKeyInput) => {
  if (input.messageId) return `message:${input.messageId}`;
  if (input.operationId) return `operation:${input.operationId}`;
  if (input.toolCallId) return `tool-call:${input.toolCallId}`;
  return `root-source:${input.rootSourceId}`;
};

/**
 * Normalizes a domain key into the coarse accumulator bucket.
 *
 * Before:
 * - `"memory:user-preference"`
 *
 * After:
 * - `"memory"`
 */
export const getCoarseProcedureDomain = (domainKey: string) => domainKey.split(':')[0] ?? domainKey;

/**
 * Input for building a fully qualified procedure marker key.
 */
export interface ProcedureMarkerKeyInput {
  /** Fine-grained domain key guarded by the marker. */
  domainKey: string;
  /** Optional intent class guarded by the marker. */
  intentClass?: string;
  /** Structured procedure key created from ids, never text. */
  procedureKey: string;
  /** Runtime scope shared by direct outcomes and planner suppression. */
  scopeKey: string;
}

/**
 * Builds a Redis policy-state key for a procedure marker.
 *
 * Use when:
 * - Writing a handled marker after procedure record persistence succeeds
 * - Reading markers for planner suppression
 *
 * Expects:
 * - Caller already selected the correct runtime scope
 *
 * Returns:
 * - Fully qualified marker key string
 */
export const buildProcedureMarkerKey = (input: ProcedureMarkerKeyInput) => {
  return [
    'agent-signal:policy:procedure-marker',
    input.scopeKey,
    input.domainKey,
    input.intentClass ?? 'unknown',
    input.procedureKey,
  ].join(':');
};

/**
 * Creates candidate marker keys for suppression reads.
 *
 * Use when:
 * - Planner needs to check multiple plausible intent classes
 * - Direct outcomes may have written a more specific intent class than the planner inferred
 *
 * Expects:
 * - `procedureKey`, `scopeKey`, and `domainKey` identify the same procedure family
 *
 * Returns:
 * - Deduplicated marker keys in candidate order
 */
export const createProcedureMarkerKeysForRead = (
  input: ProcedureMarkerKeyInput & { intentClassCandidates?: string[] },
) => {
  const candidates = input.intentClassCandidates?.length
    ? input.intentClassCandidates
    : [input.intentClass ?? 'unknown'];

  return [...new Set(candidates)].map((intentClass) =>
    buildProcedureMarkerKey({ ...input, intentClass }),
  );
};
