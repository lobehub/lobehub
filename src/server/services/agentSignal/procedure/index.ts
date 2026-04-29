import type { AgentSignalPolicyStateStore } from '../store/types';
import {
  appendAndScoreProcedureAccumulatorRecord,
  appendProcedureAccumulatorRecord,
} from './accumulator';
import { createProcedureMarkerKeysForRead } from './keys';
import { readFirstActiveHandledProcedureMarker, writeProcedureMarker } from './marker';
import { appendProcedureReceipt } from './receipt';
import { writeProcedureRecordField } from './record';
import type { AgentSignalProcedureRecord } from './types';

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
  const appendRecord = async (record: AgentSignalProcedureRecord) => {
    await appendProcedureAccumulatorRecord(input.policyStateStore, record, input.ttlSeconds);
  };

  return {
    accumulator: {
      appendAndScore: (record: AgentSignalProcedureRecord) =>
        appendAndScoreProcedureAccumulatorRecord(input.policyStateStore, record, input.ttlSeconds, {
          now: now(),
        }),
      appendRecord,
    },
    markerReader: {
      shouldSuppress: async (markerInput: {
        domainKey: string;
        intentClass?: string;
        intentClassCandidates?: string[];
        procedureKey: string;
        scopeKey: string;
      }) => {
        const marker = await readFirstActiveHandledProcedureMarker(
          input.policyStateStore,
          createProcedureMarkerKeysForRead(markerInput),
          now(),
        );

        return Boolean(marker);
      },
    },
    markerStore: {
      write: (marker: Parameters<typeof writeProcedureMarker>[1]) =>
        writeProcedureMarker(input.policyStateStore, marker, input.ttlSeconds),
    },
    now,
    receiptStore: {
      append: (receipt: Parameters<typeof appendProcedureReceipt>[1]) =>
        appendProcedureReceipt(input.policyStateStore, receipt, {
          maxItems: 8,
          ttlSeconds: input.ttlSeconds,
        }),
    },
    recordStore: {
      write: (record: AgentSignalProcedureRecord) =>
        writeProcedureRecordField(input.policyStateStore, record, input.ttlSeconds),
    },
    ttlSeconds: input.ttlSeconds,
  };
};
