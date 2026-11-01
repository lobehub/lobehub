import type { AgentSignalPolicyStateStore } from '../store/types';
import { PROCEDURE_RECORDS_POLICY_ID } from './keys';
import type { AgentSignalProcedureRecord } from './types';

let recordSeed = 0;

const createRecordId = () => {
  if (globalThis.crypto?.randomUUID) return `procedure-record:${globalThis.crypto.randomUUID()}`;
  recordSeed += 1;
  return `procedure-record:${Date.now().toString(36)}:${recordSeed.toString(36)}`;
};

/**
 * Creates a compact procedure record with a generated id when needed.
 *
 * Use when:
 * - Projecting existing runtime graph nodes into policy facts
 * - Direct tool outcomes need a durable synchronous projection
 *
 * Expects:
 * - Caller supplies domain, scope, refs, and status
 *
 * Returns:
 * - Procedure record with stable id
 */
export const createProcedureRecord = (
  input: Omit<AgentSignalProcedureRecord, 'id'> & { id?: string },
): AgentSignalProcedureRecord => ({
  ...input,
  id: input.id ?? createRecordId(),
});

/**
 * Writes one procedure record into the scope-local record map.
 *
 * Use when:
 * - Policy state needs compact records for inspection and continuity
 * - Record write must happen before marker writes
 *
 * Expects:
 * - Store writes merge hash fields without replacing other records
 *
 * Returns:
 * - Resolves after the record field is persisted
 */
export const writeProcedureRecordField = async (
  store: AgentSignalPolicyStateStore,
  record: AgentSignalProcedureRecord,
  ttlSeconds: number,
) => {
  await store.writePolicyState(
    PROCEDURE_RECORDS_POLICY_ID,
    record.scopeKey,
    { [`record:${record.id}`]: JSON.stringify(record) },
    ttlSeconds,
  );
};
