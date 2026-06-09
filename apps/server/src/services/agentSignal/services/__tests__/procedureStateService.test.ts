import { createProcedureMarker } from '../../procedure';
import type { AgentSignalPolicyStateStore } from '../../store/types';
import { createProcedureStateService } from '../procedureStateService';

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

describe('ProcedureStateService', () => {
  /**
   * @example
   * service markers suppress after writing an active handled marker.
   */
  it('writes procedure state and suppresses an active handled marker', async () => {
    const service = createProcedureStateService({
      now: () => 150,
      policyStateStore: createStore(),
      ttlSeconds: 60,
    });
    const record = {
      accumulatorRole: 'context' as const,
      createdAt: 100,
      domainKey: 'memory:user-preference',
      id: 'procedure-record:memory-1',
      intentClass: 'explicit_persistence',
      refs: { sourceIds: ['source_1'] },
      scopeKey: 'topic:t1',
      status: 'handled' as const,
      summary: 'Saved preference.',
    };
    const marker = createProcedureMarker({
      createdAt: 110,
      domainKey: record.domainKey,
      expiresAt: 300,
      intentClass: record.intentClass,
      markerType: 'handled',
      procedureKey: 'message:m1',
      recordId: record.id,
      scopeKey: record.scopeKey,
    });
    const receipt = {
      createdAt: 120,
      domainKey: record.domainKey,
      id: 'procedure-receipt:memory-1',
      intentClass: record.intentClass,
      recordIds: [record.id],
      scopeKey: record.scopeKey,
      status: 'handled' as const,
      summary: 'Saved preference.',
      updatedAt: 120,
    };

    await service.records.write(record);
    await service.accumulators.append(record);
    await service.receipts.append(receipt);
    await service.markers.write(marker);

    await expect(
      service.markers.shouldSuppress({
        domainKey: record.domainKey,
        intentClass: record.intentClass,
        procedureKey: 'message:m1',
        scopeKey: record.scopeKey,
      }),
    ).resolves.toBe(true);
    await expect(service.inspect.scope(record.scopeKey)).resolves.toEqual(
      expect.objectContaining({
        markers: [marker],
        receipts: [receipt],
        records: [record],
      }),
    );
  });

  /**
   * @example
   * service.markers.writeAccumulated(input) writes an accumulated marker with facade-owned expiry.
   */
  it('writes accumulated markers without exposing marker expiry to callers', async () => {
    const store = createStore();
    const service = createProcedureStateService({
      now: () => 100,
      policyStateStore: store,
      ttlSeconds: 60,
    });

    await service.markers.writeAccumulated({
      domainKey: 'skill',
      intentClass: 'implicit_positive',
      procedureKey: 'message:msg_1',
      recordId: 'procedure-record:skill-1',
      scopeKey: 'topic:t1',
      signalId: 'signal:score-1',
      sourceId: 'source_1',
    });

    const snapshot = await service.inspect.scope('topic:t1');

    expect(snapshot.markers).toEqual([
      expect.objectContaining({
        domainKey: 'skill',
        expiresAt: 60_100,
        markerType: 'accumulated',
        signalId: 'signal:score-1',
      }),
    ]);
  });

  /**
   * @example
   * second weak skill candidate crosses the scoring gate and emits maintain.
   */
  it('appends and scores repeated weak skill candidate records', async () => {
    const service = createProcedureStateService({
      now: () => 200,
      policyStateStore: createStore(),
      ttlSeconds: 60,
    });
    const firstRecord = {
      accumulatorRole: 'candidate' as const,
      cheapScoreDelta: 0.6,
      createdAt: 100,
      domainKey: 'skill:managed-skill',
      id: 'procedure-record:skill-1',
      refs: {},
      scopeKey: 'topic:t1',
      status: 'observed' as const,
    };
    const secondRecord = {
      ...firstRecord,
      createdAt: 110,
      id: 'procedure-record:skill-2',
    };

    await expect(service.accumulators.appendAndScore(firstRecord)).resolves.toBeUndefined();
    await expect(service.accumulators.appendAndScore(secondRecord)).resolves.toEqual(
      expect.objectContaining({
        bucket: expect.objectContaining({
          bucketKey: 'topic:t1:skill',
          recordIds: ['procedure-record:skill-1', 'procedure-record:skill-2'],
        }),
        score: expect.objectContaining({
          aggregateScore: 1.2,
          suggestedActions: ['maintain'],
        }),
      }),
    );
  });
});
