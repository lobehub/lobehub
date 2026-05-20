import type { AgentSignalPolicyStateStore } from '../../store/types';
import { AgentSignalProcedureInspector } from '../inspector';
import {
  PROCEDURE_ACCUMULATOR_POLICY_ID,
  PROCEDURE_MARKER_INDEX_POLICY_ID,
  PROCEDURE_MARKER_POLICY_ID,
  PROCEDURE_RECEIPTS_POLICY_ID,
  PROCEDURE_RECORDS_POLICY_ID,
} from '../keys';

const createStore = (): AgentSignalPolicyStateStore => {
  const state = new Map<string, Record<string, string>>();

  return {
    readPolicyState: async (policyId, scopeKey) => state.get(`${policyId}:${scopeKey}`),
    writePolicyState: async (policyId, scopeKey, data) => {
      const key = `${policyId}:${scopeKey}`;
      state.set(key, { ...state.get(key), ...data });
    },
  };
};

describe('AgentSignalProcedureInspector', () => {
  /**
   * @example
   * inspector.inspectScope('topic:t1') returns records, markers, receipts, and accumulator fields.
   */
  it('reads procedure projections from an injected policy state store', async () => {
    const store = createStore();
    const marker = {
      createdAt: 100,
      domainKey: 'memory:user-preference',
      expiresAt: 200,
      key: 'marker_1',
      markerType: 'handled',
      scopeKey: 'topic:t1',
    };
    const receipt = {
      createdAt: 100,
      domainKey: 'memory:user-preference',
      id: 'receipt_1',
      scopeKey: 'topic:t1',
      status: 'handled',
      summary: 'Saved preference.',
      updatedAt: 100,
    };
    const record = {
      createdAt: 100,
      domainKey: 'memory:user-preference',
      id: 'record_1',
      refs: {},
      scopeKey: 'topic:t1',
      status: 'handled',
    };

    await store.writePolicyState(
      PROCEDURE_RECORDS_POLICY_ID,
      'topic:t1',
      { 'record:record_1': JSON.stringify(record) },
      60,
    );
    await store.writePolicyState(
      PROCEDURE_MARKER_INDEX_POLICY_ID,
      'topic:t1',
      { 'marker:marker_1': JSON.stringify(marker) },
      60,
    );
    await store.writePolicyState(
      PROCEDURE_MARKER_POLICY_ID,
      'marker_1',
      { marker: JSON.stringify(marker) },
      60,
    );
    await store.writePolicyState(
      PROCEDURE_RECEIPTS_POLICY_ID,
      'topic:t1',
      { 'receipt:receipt_1': JSON.stringify(receipt) },
      60,
    );
    await store.writePolicyState(
      PROCEDURE_ACCUMULATOR_POLICY_ID,
      'topic:t1:memory',
      { bucketKey: 'topic:t1:memory' },
      60,
    );

    const inspector = new AgentSignalProcedureInspector(store);

    await expect(inspector.inspectScope('topic:t1')).resolves.toEqual({
      accumulatorFields: { bucketKey: 'topic:t1:memory' },
      markers: [marker],
      receipts: [receipt],
      records: [record],
    });
    await expect(inspector.inspectMarkerKeys(['marker_1'])).resolves.toEqual([marker]);
  });
});
