import type { AgentSignalPolicyStateStore } from '../../store/types';
import { emitToolOutcomeSafely, recordToolOutcome } from '../emitToolOutcome';
import {
  buildProcedureMarkerKey,
  PROCEDURE_MARKER_POLICY_ID,
  PROCEDURE_RECEIPTS_POLICY_ID,
  PROCEDURE_RECORDS_POLICY_ID,
} from '../keys';

const createStore = (): AgentSignalPolicyStateStore => {
  const state = new Map<string, Record<string, string>>();

  return {
    readPolicyState: async (policyId, scopeKey) => state.get(`${policyId}:${scopeKey}`),
    writePolicyState: async (policyId, scopeKey, data) => {
      state.set(`${policyId}:${scopeKey}`, {
        ...state.get(`${policyId}:${scopeKey}`),
        ...data,
      });
    },
  };
};

describe('recordToolOutcome', () => {
  /**
   * @example
   * recordToolOutcome({ status: 'succeeded' }) writes projection state without enqueueing workflow.
   */
  it('writes direct tool procedure projection synchronously', async () => {
    const store = createStore();

    await recordToolOutcome({
      apiName: 'addPreferenceMemory',
      context: { userId: 'u1' },
      domainKey: 'memory:user-preference',
      identifier: 'lobe-user-memory',
      intentClass: 'explicit_persistence',
      messageId: 'm1',
      policyStateStore: store,
      scope: { topicId: 't1', userId: 'u1' },
      scopeKey: 'topic:t1',
      status: 'succeeded',
      summary: 'Saved preference.',
      toolAction: 'create',
      ttlSeconds: 3600,
    });

    const markerKey = buildProcedureMarkerKey({
      domainKey: 'memory:user-preference',
      intentClass: 'explicit_persistence',
      procedureKey: 'message:m1',
      scopeKey: 'topic:t1',
    });

    await expect(store.readPolicyState(PROCEDURE_MARKER_POLICY_ID, markerKey)).resolves.toEqual({
      marker: expect.stringContaining('memory:user-preference'),
    });
    await expect(store.readPolicyState(PROCEDURE_RECORDS_POLICY_ID, 'topic:t1')).resolves.toEqual(
      expect.objectContaining({
        'record:procedure-record:tool-outcome:lobe-user-memory:addPreferenceMemory:succeeded:m1':
          expect.stringContaining('Saved preference.'),
      }),
    );
    await expect(store.readPolicyState(PROCEDURE_RECEIPTS_POLICY_ID, 'topic:t1')).resolves.toEqual(
      expect.objectContaining({
        'receipt:procedure-receipt:procedure-record:tool-outcome:lobe-user-memory:addPreferenceMemory:succeeded:m1':
          expect.stringContaining('handled'),
      }),
    );
  });

  /**
   * @example
   * emitToolOutcomeSafely(input) logs but does not reject when procedure storage fails.
   */
  it('does not reject when procedure projection fails after a tool side effect', async () => {
    const error = new Error('redis unavailable');
    const store: AgentSignalPolicyStateStore = {
      readPolicyState: async () => undefined,
      writePolicyState: async () => {
        throw error;
      },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      emitToolOutcomeSafely({
        apiName: 'addPreferenceMemory',
        context: { userId: 'u1' },
        domainKey: 'memory:user-preference',
        identifier: 'lobe-user-memory',
        intentClass: 'explicit_persistence',
        messageId: 'm1',
        policyStateStore: store,
        scope: { topicId: 't1', userId: 'u1' },
        scopeKey: 'topic:t1',
        status: 'succeeded',
        summary: 'Saved preference.',
        toolAction: 'create',
        ttlSeconds: 3600,
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith('[AgentSignal] Failed to emit tool outcome:', error);
    consoleError.mockRestore();
  });
});
