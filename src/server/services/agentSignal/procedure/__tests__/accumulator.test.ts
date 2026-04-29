import type { AgentSignalPolicyStateStore } from '../../store/types';
import {
  appendAndScoreProcedureAccumulatorRecord,
  appendDomainProcedureRecord,
  shouldScoreAccumulator,
} from '../accumulator';
import { PROCEDURE_ACCUMULATOR_POLICY_ID } from '../keys';

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

describe('DomainProcedureAccumulator', () => {
  /**
   * @example
   * appendDomainProcedureRecord(undefined, record).bucketKey === 'topic:t1:memory'
   */
  it('puts records into coarse domain buckets', () => {
    const state = appendDomainProcedureRecord(undefined, {
      createdAt: 100,
      domainKey: 'memory:user-preference',
      id: 'record_1',
      refs: {},
      scopeKey: 'topic:t1',
      status: 'observed',
    });

    expect(state.bucketKey).toBe('topic:t1:memory');
    expect(state.recordIds).toEqual(['record_1']);
  });

  /**
   * @example
   * context records keep cheapScore at zero.
   */
  it('does not add cheap score for direct tool context records', () => {
    const state = appendDomainProcedureRecord(undefined, {
      accumulatorRole: 'context',
      cheapScoreDelta: 9,
      createdAt: 100,
      domainKey: 'skill:managed-skill',
      id: 'record_1',
      refs: {},
      scopeKey: 'topic:t1',
      status: 'handled',
    });

    expect(state.cheapScore).toBe(0);
    expect(shouldScoreAccumulator(state, { cheapScoreThreshold: 1, minRecords: 2, now: 100 })).toBe(
      false,
    );
  });

  /**
   * @example
   * malformed record fields are ignored while valid bucket records still score.
   */
  it('ignores malformed and cross-bucket fields while scoring persisted records', async () => {
    const store = createStore();
    const bucketKey = 'topic:t1:skill';

    await store.writePolicyState(
      PROCEDURE_ACCUMULATOR_POLICY_ID,
      bucketKey,
      {
        'record:bad-json': '{bad',
        'record:missing-shape': JSON.stringify({ id: 'missing-shape' }),
        'record:other-domain': JSON.stringify({
          accumulatorRole: 'candidate',
          cheapScoreDelta: 9,
          createdAt: 100,
          domainKey: 'memory:user-preference',
          id: 'other-domain',
          refs: {},
          scopeKey: 'topic:t1',
          status: 'observed',
        }),
        'record:other-scope': JSON.stringify({
          accumulatorRole: 'candidate',
          cheapScoreDelta: 9,
          createdAt: 110,
          domainKey: 'skill',
          id: 'other-scope',
          refs: {},
          scopeKey: 'topic:other',
          status: 'observed',
        }),
        'record:string-score': JSON.stringify({
          accumulatorRole: 'candidate',
          cheapScoreDelta: '0.6',
          createdAt: 115,
          domainKey: 'skill',
          id: 'string-score',
          refs: {},
          scopeKey: 'topic:t1',
          status: 'observed',
        }),
        'record:valid-existing': JSON.stringify({
          accumulatorRole: 'candidate',
          cheapScoreDelta: 0.6,
          createdAt: 120,
          domainKey: 'skill',
          id: 'valid-existing',
          refs: {},
          scopeKey: 'topic:t1',
          status: 'observed',
        }),
      },
      60,
    );

    const result = await appendAndScoreProcedureAccumulatorRecord(
      store,
      {
        accumulatorRole: 'candidate',
        cheapScoreDelta: 0.6,
        createdAt: 130,
        domainKey: 'skill',
        id: 'valid-new',
        refs: {},
        scopeKey: 'topic:t1',
        status: 'observed',
      },
      60,
      { now: 140 },
    );

    expect(result).toEqual(
      expect.objectContaining({
        bucket: expect.objectContaining({
          cheapScore: 1.2,
          recordIds: ['valid-existing', 'valid-new'],
        }),
        score: expect.objectContaining({
          aggregateScore: 1.2,
          suggestedActions: ['maintain'],
        }),
      }),
    );
    expect(result?.records.map((record) => record.id)).toEqual(['valid-existing', 'valid-new']);
  });

  /**
   * @example
   * re-appending an already scored record set does not emit a duplicate score.
   */
  it('does not score the same persisted record set twice', async () => {
    const store = createStore();
    const existingRecord = {
      accumulatorRole: 'candidate' as const,
      cheapScoreDelta: 0.6,
      createdAt: 90,
      domainKey: 'skill',
      id: 'record_0',
      refs: {},
      scopeKey: 'topic:t1',
      status: 'observed' as const,
    };
    const record = {
      accumulatorRole: 'candidate' as const,
      cheapScoreDelta: 0.6,
      createdAt: 100,
      domainKey: 'skill',
      id: 'record_1',
      refs: {},
      scopeKey: 'topic:t1',
      status: 'observed' as const,
    };

    await appendAndScoreProcedureAccumulatorRecord(store, existingRecord, 60, { now: 100 });
    const first = await appendAndScoreProcedureAccumulatorRecord(store, record, 60, { now: 110 });
    await store.writePolicyState(
      PROCEDURE_ACCUMULATOR_POLICY_ID,
      'topic:t1:skill',
      { recordIds: JSON.stringify(['record_1', 'record_0']) },
      60,
    );
    const second = await appendAndScoreProcedureAccumulatorRecord(store, record, 60, { now: 120 });

    expect(first?.score.suggestedActions).toEqual(['maintain']);
    expect(second).toBeUndefined();
  });
});
