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
   * recordToolOutcome({ operationId: 'op1', toolCallId: 'call1' }) keeps each call distinct.
   */
  it('uses tool call id before operation id for per-call outcome identity', async () => {
    const store = createStore();
    const baseInput = {
      apiName: 'addPreferenceMemory',
      context: { userId: 'u1' },
      domainKey: 'memory:user-preference',
      identifier: 'lobe-user-memory',
      intentClass: 'explicit_persistence',
      messageId: 'm1',
      operationId: 'op1',
      policyStateStore: store,
      scope: { topicId: 't1', userId: 'u1' },
      scopeKey: 'topic:t1',
      status: 'succeeded' as const,
      toolAction: 'create',
      ttlSeconds: 3600,
    };

    // ROOT CAUSE:
    //
    // If operation id wins over tool call id, two calls to the same tool API in one operation
    // produce the same source id. Records and receipts use that source id as their hash field,
    // so the second call overwrites the first projection.
    //
    // We keep procedure suppression message-scoped, but make outcome source identity per-call.
    const first = await recordToolOutcome({
      ...baseInput,
      summary: 'Saved first preference.',
      toolCallId: 'call1',
    });
    const second = await recordToolOutcome({
      ...baseInput,
      summary: 'Saved second preference.',
      toolCallId: 'call2',
    });

    expect(first.sourceId).not.toBe(second.sourceId);

    const records = await store.readPolicyState(PROCEDURE_RECORDS_POLICY_ID, 'topic:t1');
    const receipts = await store.readPolicyState(PROCEDURE_RECEIPTS_POLICY_ID, 'topic:t1');
    expect(Object.keys(records ?? {}).filter((key) => key.startsWith('record:'))).toHaveLength(2);
    expect(Object.keys(receipts ?? {}).filter((key) => key.startsWith('receipt:'))).toHaveLength(2);

    const markerKey = buildProcedureMarkerKey({
      domainKey: 'memory:user-preference',
      intentClass: 'explicit_persistence',
      procedureKey: 'message:m1',
      scopeKey: 'topic:t1',
    });

    await expect(store.readPolicyState(PROCEDURE_MARKER_POLICY_ID, markerKey)).resolves.toEqual({
      marker: expect.stringContaining('message:m1'),
    });
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

  /**
   * Regression for LOBE-11930 P1: `activatorRuntime`'s `emitActivationOutcome`
   * called `emitToolOutcomeSafely` unconditionally on every share-visitor
   * `activateSkill`/`markActivated` call, using `context.userId` — the share
   * **creator**, never the visitor — writing creator-scoped procedure state
   * and reaching the `signal.tool.outcome` self-reflection accumulator for a
   * visitor's turn. `agentShare` is now the single choke point every direct
   * tool-outcome emitter funnels through; this proves presence of that marker
   * blocks the write regardless of which call site forgot its own guard.
   *
   * @example
   * recordToolOutcome({ agentShare: { agentId: 'a1', visitorUserId: 'v1' } }) writes nothing.
   */
  it('writes nothing when the input carries an agentShare marker', async () => {
    const store = createStore();

    await recordToolOutcome({
      agentShare: { agentId: 'agent-1', visitorUserId: 'visitor-1' },
      apiName: 'activateSkill',
      context: { agentId: 'agent-1', userId: 'creator-1' },
      domainKey: 'skill:builtin-skill',
      identifier: 'lobe-activator',
      intentClass: 'tool_command',
      messageId: 'm1',
      policyStateStore: store,
      scope: { agentId: 'agent-1', topicId: 't1', userId: 'creator-1' },
      scopeKey: 'topic:t1',
      status: 'succeeded',
      summary: 'Activator selected a skill.',
      toolAction: 'activate',
      ttlSeconds: 3600,
    });

    await expect(
      store.readPolicyState(PROCEDURE_RECORDS_POLICY_ID, 'topic:t1'),
    ).resolves.toBeUndefined();
    await expect(
      store.readPolicyState(PROCEDURE_RECEIPTS_POLICY_ID, 'topic:t1'),
    ).resolves.toBeUndefined();
  });

  /**
   * Same as above, but through the full `emitToolOutcomeSafely` entry point
   * used by every server tool runtime — proves the async
   * `enqueueAgentSignalSourceEvent` fan-out (which drives self-reflection
   * accumulation) is also skipped, not just the synchronous projection.
   */
  it('emitToolOutcomeSafely is a no-op end to end when agentShare is present', async () => {
    const store = createStore();

    await emitToolOutcomeSafely({
      agentShare: { agentId: 'agent-1', visitorUserId: 'visitor-1' },
      apiName: 'activateSkill',
      context: { agentId: 'agent-1', userId: 'creator-1' },
      domainKey: 'skill:builtin-skill',
      identifier: 'lobe-activator',
      intentClass: 'tool_command',
      messageId: 'm1',
      policyStateStore: store,
      scope: { agentId: 'agent-1', topicId: 't1', userId: 'creator-1' },
      scopeKey: 'topic:t1',
      status: 'succeeded',
      summary: 'Activator selected a skill.',
      toolAction: 'activate',
      ttlSeconds: 3600,
    });

    await expect(
      store.readPolicyState(PROCEDURE_RECORDS_POLICY_ID, 'topic:t1'),
    ).resolves.toBeUndefined();
  });

  /**
   * Fail-closed even when the share marker itself is incomplete/malformed —
   * this function has no way to validate its shape, so presence alone must
   * be enough to block.
   */
  it('treats an incomplete agentShare marker as still present and blocks', async () => {
    const store = createStore();

    await recordToolOutcome({
      agentShare: {},
      apiName: 'activateSkill',
      context: { agentId: 'agent-1', userId: 'creator-1' },
      domainKey: 'skill:builtin-skill',
      identifier: 'lobe-activator',
      intentClass: 'tool_command',
      messageId: 'm1',
      policyStateStore: store,
      scope: { agentId: 'agent-1', topicId: 't1', userId: 'creator-1' },
      scopeKey: 'topic:t1',
      status: 'succeeded',
      summary: 'Activator selected a skill.',
      toolAction: 'activate',
      ttlSeconds: 3600,
    });

    await expect(
      store.readPolicyState(PROCEDURE_RECORDS_POLICY_ID, 'topic:t1'),
    ).resolves.toBeUndefined();
  });
});
