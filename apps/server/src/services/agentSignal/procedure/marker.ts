import type { AgentSignalPolicyStateStore } from '../store/types';
import {
  buildProcedureMarkerKey,
  PROCEDURE_MARKER_INDEX_POLICY_ID,
  PROCEDURE_MARKER_POLICY_ID,
} from './keys';
import type { AgentSignalProcedureMarker } from './types';

/**
 * Creates a marker and derives its policy-state key.
 *
 * Use when:
 * - A procedure record has already been persisted
 * - The planner or accumulator needs a compact gate
 *
 * Expects:
 * - `procedureKey` is based on structured ids only
 *
 * Returns:
 * - Marker with fully qualified key
 */
export const createProcedureMarker = (
  input: Omit<AgentSignalProcedureMarker, 'key'> & { procedureKey: string },
): AgentSignalProcedureMarker => ({
  ...input,
  key: buildProcedureMarkerKey(input),
});

/**
 * Checks whether a marker is still active.
 *
 * Use when:
 * - Reading marker state for suppression
 * - Filtering stale policy gates
 *
 * Expects:
 * - `now` is a millisecond timestamp
 *
 * Returns:
 * - Whether the marker has not expired
 */
export const isProcedureMarkerActive = (marker: AgentSignalProcedureMarker, now: number) =>
  marker.expiresAt > now;

/**
 * Checks whether marker state should suppress planner actions.
 *
 * Use when:
 * - Planner is deciding whether same-source work was already handled
 * - Only handled markers should suppress actions
 *
 * Expects:
 * - Missing markers and non-handled markers are not suppression signals
 *
 * Returns:
 * - Whether planner actions should be suppressed
 */
export const shouldSuppressByMarker = (
  marker: AgentSignalProcedureMarker | undefined,
  now: number,
) => marker?.markerType === 'handled' && isProcedureMarkerActive(marker, now);

/**
 * Writes a procedure marker and scope index entry.
 *
 * Use when:
 * - Procedure record persistence has already succeeded
 * - Eval and inspection tools need scope-local marker discovery
 *
 * Expects:
 * - Store writes are policy-state hash merges
 *
 * Returns:
 * - Resolves after marker and index writes complete
 */
export const writeProcedureMarker = async (
  store: AgentSignalPolicyStateStore,
  marker: AgentSignalProcedureMarker,
  ttlSeconds: number,
) => {
  await store.writePolicyState(
    PROCEDURE_MARKER_POLICY_ID,
    marker.key,
    { marker: JSON.stringify(marker) },
    ttlSeconds,
  );
  await store.writePolicyState(
    PROCEDURE_MARKER_INDEX_POLICY_ID,
    marker.scopeKey,
    { [`marker:${encodeURIComponent(marker.key)}`]: JSON.stringify(marker) },
    ttlSeconds,
  );
};

/**
 * Reads one procedure marker by fully qualified marker key.
 *
 * Use when:
 * - Planner checks a specific suppression candidate
 * - Inspector needs exact marker reads
 *
 * Expects:
 * - Marker payload is JSON written by {@link writeProcedureMarker}
 *
 * Returns:
 * - Parsed marker or undefined when absent
 */
export const readProcedureMarker = async (
  store: Pick<AgentSignalPolicyStateStore, 'readPolicyState'>,
  markerKey: string,
) => {
  const state = await store.readPolicyState(PROCEDURE_MARKER_POLICY_ID, markerKey);
  if (!state?.marker) return undefined;
  return JSON.parse(state.marker) as AgentSignalProcedureMarker;
};

/**
 * Reads candidate marker keys and returns the first active handled marker.
 *
 * Use when:
 * - Planner has multiple possible intent-class marker keys
 * - Suppression should stop at the first active handled marker
 *
 * Expects:
 * - `markerKeys` are already ordered by caller preference
 *
 * Returns:
 * - Active handled marker or undefined
 */
export const readFirstActiveHandledProcedureMarker = async (
  store: Pick<AgentSignalPolicyStateStore, 'readPolicyState'>,
  markerKeys: string[],
  now: number,
) => {
  for (const markerKey of markerKeys) {
    const marker = await readProcedureMarker(store, markerKey);
    if (shouldSuppressByMarker(marker, now)) return marker;
  }

  return undefined;
};
