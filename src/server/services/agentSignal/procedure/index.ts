import { createProcedureStateService } from '../services/procedureStateService';
import type { AgentSignalPolicyStateStore } from '../store/types';
import type { AgentSignalProcedureRecord } from './types';

export { createProcedureStateService } from '../services/procedureStateService';
export * from './accumulator';
export * from './batchScorer';
export * from './emitToolOutcome';
export * from './inspector';
export * from './keys';
export * from './marker';
export * from './receipt';
export * from './record';
export * from './toolOutcome';
export * from './types';

/**
 * Input for composing procedure policy dependencies from one policy-state store.
 */
export interface CreateProcedurePolicyOptionsInput {
  /** Optional current-time provider for deterministic tests and eval runs. */
  now?: () => number;
  /** Policy-state store shared by records, markers, receipts, and accumulators. */
  policyStateStore: AgentSignalPolicyStateStore;
  /** TTL in seconds for procedure policy-state fields. */
  ttlSeconds: number;
}

/**
 * Composes procedure policy dependencies from a policy-state store.
 *
 * Use when:
 * - Default Agent Signal policies need procedure projections
 * - Tests or evals need isolated in-memory policy state
 *
 * Expects:
 * - One policy-state store backs all procedure projections for a runtime
 *
 * Returns:
 * - Dependency bag consumed by procedure-aware policy handlers
 */
export const createProcedurePolicyOptions = (input: CreateProcedurePolicyOptionsInput) => {
  const now = input.now ?? (() => Date.now());
  const procedureState = createProcedureStateService({ ...input, now });

  return {
    accumulator: {
      appendAndScore: (record: AgentSignalProcedureRecord) =>
        procedureState.accumulators.appendAndScore(record),
      appendRecord: (record: AgentSignalProcedureRecord) =>
        procedureState.accumulators.append(record),
    },
    markerReader: {
      shouldSuppress: (markerInput: {
        domainKey: string;
        intentClass?: string;
        intentClassCandidates?: string[];
        procedureKey: string;
        scopeKey: string;
      }) => procedureState.markers.shouldSuppress(markerInput),
    },
    markerStore: {
      write: procedureState.markers.write,
    },
    now,
    procedureState,
    receiptStore: {
      append: procedureState.receipts.append,
    },
    recordStore: {
      write: (record: AgentSignalProcedureRecord) => procedureState.records.write(record),
    },
    ttlSeconds: input.ttlSeconds,
  };
};
