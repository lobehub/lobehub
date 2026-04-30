import type { AgentSignalPolicyStateStore } from '../store/types';
import {
  PROCEDURE_ACCUMULATOR_POLICY_ID,
  PROCEDURE_MARKER_INDEX_POLICY_ID,
  PROCEDURE_MARKER_POLICY_ID,
  PROCEDURE_RECEIPTS_POLICY_ID,
  PROCEDURE_RECORDS_POLICY_ID,
} from './keys';
import type {
  AgentSignalProcedureMarker,
  AgentSignalProcedureReceipt,
  AgentSignalProcedureRecord,
} from './types';

/**
 * Procedure projection snapshot for one runtime scope.
 */
export interface AgentSignalProcedureInspectionSnapshot {
  /** Raw accumulator fields merged from known coarse domain buckets. */
  accumulatorFields: Record<string, string>;
  /** Scope-indexed procedure markers. */
  markers: AgentSignalProcedureMarker[];
  /** Scope-local procedure receipts. */
  receipts: AgentSignalProcedureReceipt[];
  /** Scope-local procedure records. */
  records: AgentSignalProcedureRecord[];
}

/**
 * Reads compact Agent Signal procedure projections for devtools and evals.
 *
 * Use when:
 * - Eval assertions need procedure state written by the runtime
 * - Devtools need compact records, markers, receipts, and accumulator fields
 *
 * Expects:
 * - Store values are JSON fields written by procedure helpers
 *
 * Returns:
 * - Inspection snapshots without exposing a production route
 */
export class AgentSignalProcedureInspector {
  constructor(private readonly store: Pick<AgentSignalPolicyStateStore, 'readPolicyState'>) {}

  /**
   * Inspects records, markers, receipts, and known accumulator buckets for one scope.
   *
   * Use when:
   * - Eval assertions need a scope-local procedure snapshot
   * - Devtools need compact state without querying Redis keys directly
   *
   * Expects:
   * - `scopeKey` uses the same scope as runtime execution
   *
   * Returns:
   * - Parsed procedure inspection snapshot
   */
  async inspectScope(scopeKey: string): Promise<AgentSignalProcedureInspectionSnapshot> {
    const recordsState = await this.store.readPolicyState(PROCEDURE_RECORDS_POLICY_ID, scopeKey);
    const markerIndexState = await this.store.readPolicyState(
      PROCEDURE_MARKER_INDEX_POLICY_ID,
      scopeKey,
    );
    const receiptsState = await this.store.readPolicyState(PROCEDURE_RECEIPTS_POLICY_ID, scopeKey);
    const accumulatorStates = await Promise.all(
      ['memory', 'document', 'skill'].map((domain) =>
        this.store.readPolicyState(PROCEDURE_ACCUMULATOR_POLICY_ID, `${scopeKey}:${domain}`),
      ),
    );
    const accumulatorFields = Object.assign({}, ...accumulatorStates);

    return {
      accumulatorFields,
      markers: Object.entries(markerIndexState ?? {})
        .filter(([key]) => key.startsWith('marker:'))
        .map(([, value]) => value)
        .map((value) => JSON.parse(value) as AgentSignalProcedureMarker),
      receipts: Object.entries(receiptsState ?? {})
        .filter(([key]) => key.startsWith('receipt:'))
        .map(([, value]) => JSON.parse(value) as AgentSignalProcedureReceipt),
      records: Object.entries(recordsState ?? {})
        .filter(([key]) => key.startsWith('record:'))
        .map(([, value]) => JSON.parse(value) as AgentSignalProcedureRecord),
    };
  }

  /**
   * Reads explicit marker keys.
   *
   * Use when:
   * - Tests need to inspect marker keys that may not be in a scope index
   * - Debugging exact suppression candidates
   *
   * Expects:
   * - Marker keys are fully qualified policy marker keys
   *
   * Returns:
   * - Parsed markers found at the requested keys
   */
  async inspectMarkerKeys(markerKeys: string[]) {
    const markers: AgentSignalProcedureMarker[] = [];

    for (const markerKey of markerKeys) {
      const state = await this.store.readPolicyState(PROCEDURE_MARKER_POLICY_ID, markerKey);
      if (state?.marker) markers.push(JSON.parse(state.marker) as AgentSignalProcedureMarker);
    }

    return markers;
  }
}
