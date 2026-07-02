import {
  readRecordedSkillIntent,
  recordSkillIntent,
} from '../policies/analyzeIntent/skillIntentRecord';
import {
  appendAndScoreProcedureAccumulatorRecord,
  appendProcedureAccumulatorRecord,
} from '../procedure/accumulators/procedure';
import { AgentSignalProcedureInspector } from '../procedure/inspector';
import { createProcedureMarkerKeysForRead } from '../procedure/keys';
import {
  createProcedureMarker,
  readFirstActiveHandledProcedureMarker,
  writeProcedureMarker,
} from '../procedure/marker';
import { appendProcedureReceipt } from '../procedure/receipt';
import { writeProcedureRecordField } from '../procedure/record';
import type { AgentSignalPolicyStateStore } from '../store/types';
import type { ProcedureStateService } from './types';

type ProcedureStateServiceWithSkillIntentRecords = ProcedureStateService & {
  skillIntentRecords: NonNullable<ProcedureStateService['skillIntentRecords']>;
};

/**
 * Input for creating the procedure state facade.
 */
export interface CreateProcedureStateServiceInput {
  /** Optional current-time provider for deterministic tests and eval runs. */
  now?: () => number;
  /** Policy-state store shared by procedure projections. */
  policyStateStore: AgentSignalPolicyStateStore;
  /** TTL in seconds for procedure policy-state fields. */
  ttlSeconds: number;
}

/**
 * Creates the data-plane facade for Agent Signal procedure policy state.
 *
 * Use when:
 * - Policy handlers need to persist or inspect procedure projections
 * - Tests need one injectable boundary over procedure helper functions
 *
 * Expects:
 * - One policy-state store backs records, markers, receipts, and accumulators
 *
 * Returns:
 * - Procedure state service backed by the provided policy-state store
 */
export const createProcedureStateService = (
  input: CreateProcedureStateServiceInput,
): ProcedureStateServiceWithSkillIntentRecords => {
  const now = input.now ?? (() => Date.now());
  const inspector = new AgentSignalProcedureInspector(input.policyStateStore);

  return {
    accumulators: {
      append: (record) =>
        appendProcedureAccumulatorRecord(input.policyStateStore, record, input.ttlSeconds),
      appendAndScore: (record) =>
        appendAndScoreProcedureAccumulatorRecord(input.policyStateStore, record, input.ttlSeconds, {
          now: now(),
        }),
    },
    inspect: {
      scope: (scopeKey) => inspector.inspectScope(scopeKey),
    },
    skillIntentRecords: {
      read: (recordInput) => readRecordedSkillIntent(input.policyStateStore, recordInput),
      write: (record) =>
        recordSkillIntent(input.policyStateStore, {
          record,
          scopeKey: record.scopeKey,
          ttlSeconds: input.ttlSeconds,
        }),
    },
    markers: {
      shouldSuppress: async (markerInput) => {
        const marker = await readFirstActiveHandledProcedureMarker(
          input.policyStateStore,
          createProcedureMarkerKeysForRead(markerInput),
          now(),
        );

        return Boolean(marker);
      },
      write: (marker) => writeProcedureMarker(input.policyStateStore, marker, input.ttlSeconds),
      writeAccumulated: (markerInput) => {
        const createdAt = now();

        return writeProcedureMarker(
          input.policyStateStore,
          createProcedureMarker({
            ...markerInput,
            createdAt,
            expiresAt: createdAt + input.ttlSeconds * 1000,
            markerType: 'accumulated',
          }),
          input.ttlSeconds,
        );
      },
    },
    records: {
      write: (record) =>
        writeProcedureRecordField(input.policyStateStore, record, input.ttlSeconds),
    },
    receipts: {
      append: (receipt) =>
        appendProcedureReceipt(input.policyStateStore, receipt, {
          maxItems: 8,
          ttlSeconds: input.ttlSeconds,
        }),
    },
  };
};
