// @vitest-environment node
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

import { hookDispatcher } from '../hooks';
import { HumanInterventionHandler } from '../HumanInterventionHandler';

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    static getEmailsByIds = async (_db: unknown, ids: string[]) =>
      ids.map((id) => ({ id, email: `${id}@example.test` }));
    getUserPreference = async () => ({});
  },
}));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));

vi.mock('@/server/services/queue/impls', () => ({
  isQueueAgentRuntimeEnabled: vi.fn(() => false),
}));
vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: vi.fn() }));

const buildHandler = (
  pluginQuery: ReturnType<typeof vi.fn>,
  messageModel: { updateMessagePlugin: any; updateToolMessage: any },
) => {
  const serverDB = { query: { messagePlugins: { findFirst: pluginQuery } } } as any;
  return new HumanInterventionHandler(serverDB, messageModel as any, 'user-1');
};

describe('HumanInterventionHandler.process', () => {
  let mockMessageModel: { updateMessagePlugin: any; updateToolMessage: any };
  let mockDBPluginQuery: ReturnType<typeof vi.fn>;
  let handler: HumanInterventionHandler;

  const makeState = (overrides: Record<string, any> = {}) => ({
    lastModified: new Date().toISOString(),
    pendingToolsCalling: [
      { apiName: 'search', arguments: '{}', id: 'tool-call-1', identifier: 'web-search' },
      { apiName: 'write', arguments: '{}', id: 'tool-call-2', identifier: 'local-system' },
    ],
    status: 'waiting_for_human',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(false);
    mockDBPluginQuery = vi.fn().mockResolvedValue({ toolCallId: 'tool-call-1' });
    mockMessageModel = {
      updateMessagePlugin: vi.fn().mockResolvedValue(undefined),
      updateToolMessage: vi.fn().mockResolvedValue({ success: true }),
    };
    handler = buildHandler(mockDBPluginQuery, mockMessageModel);
  });

  afterEach(() => vi.restoreAllMocks());

  it('retains the known native id when a legacy stopped state has no pending list', async () => {
    const dispatch = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);
    await handler.process(makeState({ operationId: 'op', pendingToolsCalling: undefined }), {
      rejectionReason: 'no',
      toolMessageId: 'message-only',
    });
    expect(dispatch.mock.calls[0][2]).toMatchObject({
      toolCallId: 'tool-call-1',
      toolCallIds: ['tool-call-1'],
    });
  });

  it.each(['approve', 'rejectAndContinue', 'reject'] as const)(
    'delivers %s from serialized configs after a worker change without registration',
    async (action) => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
      const fetch = vi.mocked(ssrfSafeFetch).mockResolvedValue(new Response(null, { status: 204 }));
      const hookType = action === 'reject' ? 'onStopByHumanIntervention' : 'afterHumanIntervention';
      // Round-trip the persisted wire payload, as a fresh queue worker does.
      const serialized = JSON.stringify(
        makeState({
          host: {
            hooks: [
              {
                id: 'persisted-human',
                type: hookType,
                webhook: {
                  url: 'https://example.com/human',
                  delivery: 'fetch',
                  body: { userId: 'user-1' },
                },
              },
            ],
          },
          operationId: 'restored-operation',
          origin: { userId: 'user-1' },
          principal: {
            actor: {
              shareVisitor: { agentId: 'agent-1', shareId: 'share-1', visitorUserId: 'visitor-1' },
            },
          },
        }),
      );
      const state = JSON.parse(serialized);
      const dispatch = vi.spyOn(hookDispatcher, 'dispatch');
      expect(hookDispatcher.hasHooks(state.operationId)).toBe(false);
      const result = await handler.process(
        state,
        action === 'approve'
          ? {
              approvedToolCall: state.pendingToolsCalling[0],
              toolMessageId: 'tool-msg-1',
            }
          : {
              rejectAndContinue: action === 'rejectAndContinue',
              rejectionReason: 'privacy',
              toolMessageId: 'tool-msg-1',
            },
      );

      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      const payload = JSON.parse(fetch.mock.calls[0][1]!.body as string);
      expect(payload).toMatchObject({
        userId: 'user-1',
        userEmail: 'user-1@example.test',
        hookId: 'persisted-human',
        hookType,
        operationId: 'restored-operation',
        toolCallId: 'tool-call-1',
        toolCallIds: action === 'reject' ? ['tool-call-1', 'tool-call-2'] : ['tool-call-1'],
      });
      expect(dispatch).toHaveBeenCalledWith(
        'restored-operation',
        hookType,
        expect.objectContaining({ userId: 'user-1' }),
        state.host.hooks,
        { ownerUserId: 'user-1' },
      );
      expect(result.newState.origin.userId).toBe('user-1');
      expect(result.newState.host.hooks).toEqual(state.host.hooks);
      if (action === 'reject') {
        expect(result.newState.interruption).toMatchObject({
          canResume: false,
          reason: 'human_rejected',
        });
        expect(result.nextContext).toBeUndefined();
      }
    },
  );

  it('does not invent a call id when rejection lookup fails', async () => {
    const dispatch = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);
    mockDBPluginQuery.mockResolvedValue(undefined);
    await handler.process(makeState({ operationId: 'op' }), {
      rejectAndContinue: true,
      rejectionReason: 'no',
      toolMessageId: 'message-only',
    });
    expect(dispatch.mock.calls[0][2]).toMatchObject({ toolCallId: undefined, toolCallIds: [] });
  });

  it.each(['approve', 'rejectAndContinue', 'reject'] as const)(
    'retains persisted configs and native identity for %s notifications',
    async (action) => {
      const dispatch = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);
      const hooks = [
        {
          id: 'human',
          type: action === 'reject' ? 'onStopByHumanIntervention' : 'afterHumanIntervention',
          webhook: { url: 'https://example.com/hook' },
        },
      ];
      const state = makeState({
        host: { hooks },
        operationId: 'real-operation',
        metadata: { operationId: 'legacy-operation' },
        origin: {
          agentId: 'agent-1',
          lineage: { parentOperationId: 'real-parent' },
          topicId: 'topic-1',
          userId: 'user-1',
        },
      });
      const result = await handler.process(
        state,
        action === 'approve'
          ? {
              approvedToolCall: state.pendingToolsCalling[0],
              toolMessageId: 'tool-msg-1',
            }
          : {
              rejectAndContinue: action === 'rejectAndContinue',
              rejectionReason: 'privacy concern',
              toolMessageId: 'tool-msg-1',
            },
      );
      expect(dispatch).toHaveBeenCalledWith(
        'real-operation',
        action === 'reject' ? 'onStopByHumanIntervention' : 'afterHumanIntervention',
        expect.objectContaining({
          ...(action === 'reject' ? { reason: 'human_rejected' } : { action }),
          agentId: 'agent-1',
          operationId: 'real-operation',
          parentOperationId: 'real-parent',
          toolCallId: 'tool-call-1',
          toolCallIds: action === 'reject' ? ['tool-call-1', 'tool-call-2'] : ['tool-call-1'],
          topicId: 'topic-1',
          userId: 'user-1',
          ...(action !== 'approve' && { rejectionReason: 'privacy concern' }),
        }),
        hooks,
        { ownerUserId: 'user-1' },
      );
      expect(result.newState.host.hooks).toEqual(hooks);
      expect(result.newState.status).toBe(
        action === 'reject' ? 'interrupted' : 'waiting_for_human',
      );
      if (action === 'reject') expect(result.nextContext).toBeUndefined();
    },
  );

  describe('approve path', () => {
    it('persists intervention=approved on the tool message', async () => {
      const state = makeState();

      await handler.process(state, {
        approvedToolCall: { id: 'tool-call-1' },
        toolMessageId: 'tool-msg-1',
      });

      expect(mockMessageModel.updateMessagePlugin).toHaveBeenCalledWith('tool-msg-1', {
        intervention: { approvedArguments: '{}', status: 'approved' },
      });
    });

    it('returns nextContext with phase=human_approved_tool and skipCreateToolMessage=true', async () => {
      const state = makeState();

      const result = await handler.process(state, {
        approvedToolCall: { id: 'tool-call-1' },
        toolMessageId: 'tool-msg-1',
      });

      expect(result.nextContext).toEqual({
        payload: {
          approvedToolCall: state.pendingToolsCalling[0],
          parentMessageId: 'tool-msg-1',
          skipCreateToolMessage: true,
        },
        phase: 'human_approved_tool',
      });
    });

    it('removes the approved tool from pendingToolsCalling', async () => {
      const state = makeState();

      const result = await handler.process(state, {
        approvedToolCall: { id: 'tool-call-1' },
        toolMessageId: 'tool-msg-1',
      });

      expect(result.newState.pendingToolsCalling).toHaveLength(1);
      expect(result.newState.pendingToolsCalling[0].id).toBe('tool-call-2');
    });

    it('keeps state waiting_for_human while other tools still pending', async () => {
      const state = makeState();

      const result = await handler.process(state, {
        approvedToolCall: { id: 'tool-call-1' },
        toolMessageId: 'tool-msg-1',
      });

      expect(result.newState.status).toBe('waiting_for_human');
    });

    it('transitions to running when last pending tool is approved', async () => {
      const state = makeState({
        pendingToolsCalling: [
          { apiName: 'search', arguments: '{}', id: 'tool-call-1', identifier: 'web-search' },
        ],
      });

      const result = await handler.process(state, {
        approvedToolCall: { id: 'tool-call-1' },
        toolMessageId: 'tool-msg-1',
      });

      expect(result.newState.status).toBe('running');
    });

    it('no-ops when toolMessageId is missing', async () => {
      const state = makeState();

      const result = await handler.process(state, {
        approvedToolCall: { id: 'tool-call-1' },
      });

      expect(mockMessageModel.updateMessagePlugin).not.toHaveBeenCalled();
      expect(result.nextContext).toBeUndefined();
    });
  });

  describe('reject path (pure)', () => {
    it('persists intervention=rejected with reason and updates content', async () => {
      const state = makeState();

      await handler.process(state, {
        rejectionReason: 'privacy concern',
        toolMessageId: 'tool-msg-1',
      });

      expect(mockMessageModel.updateToolMessage).toHaveBeenCalledWith('tool-msg-1', {
        content: 'User reject this tool calling with reason: privacy concern',
      });
      expect(mockMessageModel.updateMessagePlugin).toHaveBeenCalledWith('tool-msg-1', {
        intervention: { rejectedReason: 'privacy concern', status: 'rejected' },
      });
    });

    it('does not enter the reject branch when rejectionReason is falsy', async () => {
      const state = makeState();

      await handler.process(state, {
        rejectionReason: '',
        toolMessageId: 'tool-msg-1',
      });

      expect(mockMessageModel.updateToolMessage).not.toHaveBeenCalled();
    });

    it('writes "with reason" content for any non-empty reason', async () => {
      const state = makeState();

      await handler.process(state, {
        rejectionReason: 'r',
        toolMessageId: 'tool-msg-1',
      });

      expect(mockMessageModel.updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({
          content: 'User reject this tool calling with reason: r',
        }),
      );
    });

    it('removes the rejected tool from pendingToolsCalling by tool_call_id lookup', async () => {
      const state = makeState();
      mockDBPluginQuery.mockResolvedValueOnce({ toolCallId: 'tool-call-2' });

      const result = await handler.process(state, {
        rejectionReason: 'nope',
        toolMessageId: 'tool-msg-2',
      });

      expect(result.newState.pendingToolsCalling).toHaveLength(1);
      expect(result.newState.pendingToolsCalling[0].id).toBe('tool-call-1');
    });

    it('transitions to interrupted + reason=human_rejected (pure reject, no continue)', async () => {
      const state = makeState();

      const result = await handler.process(state, {
        rejectionReason: 'nope',
        toolMessageId: 'tool-msg-1',
      });

      expect(result.newState.status).toBe('interrupted');
      expect(result.newState.interruption).toEqual(
        expect.objectContaining({
          canResume: false,
          reason: 'human_rejected',
        }),
      );
      expect(result.nextContext).toBeUndefined();
    });
  });

  describe('reject_continue path', () => {
    it('stays paused (nextContext=undefined) when other tools are still pending', async () => {
      // makeState() has 2 pending; pluginQuery resolves tool-call-1 → 1 left.
      // Returning a `phase: 'user_input'` context here would resume the LLM
      // before the remaining pending tools are decided (review P1).
      const state = makeState();
      mockDBPluginQuery.mockResolvedValueOnce({ toolCallId: 'tool-call-1' });

      const result = await handler.process(state, {
        rejectAndContinue: true,
        rejectionReason: 'nope',
        toolMessageId: 'tool-msg-1',
      });

      expect(result.newState.status).toBe('waiting_for_human');
      expect(result.nextContext).toBeUndefined();
    });

    it('returns nextContext with phase=user_input only when this is the last pending tool', async () => {
      const state = makeState({
        pendingToolsCalling: [
          { apiName: 'search', arguments: '{}', id: 'tool-call-1', identifier: 'web-search' },
        ],
      });
      mockDBPluginQuery.mockResolvedValueOnce({ toolCallId: 'tool-call-1' });

      const result = await handler.process(state, {
        rejectAndContinue: true,
        rejectionReason: 'nope',
        toolMessageId: 'tool-msg-1',
      });

      expect(result.newState.status).toBe('running');
      expect(result.nextContext).toEqual({ phase: 'user_input' });
    });

    it('still persists intervention=rejected on the tool message', async () => {
      const state = makeState();

      await handler.process(state, {
        rejectAndContinue: true,
        rejectionReason: 'privacy',
        toolMessageId: 'tool-msg-1',
      });

      expect(mockMessageModel.updateMessagePlugin).toHaveBeenCalledWith('tool-msg-1', {
        intervention: { rejectedReason: 'privacy', status: 'rejected' },
      });
    });
  });

  describe('no-op paths', () => {
    it('returns state unchanged when status is not waiting_for_human (approve)', async () => {
      const state = makeState({ status: 'running' });

      const result = await handler.process(state, {
        approvedToolCall: { id: 'tool-call-1' },
        toolMessageId: 'tool-msg-1',
      });

      expect(result.newState).toBe(state);
      expect(result.nextContext).toBeUndefined();
      expect(mockMessageModel.updateMessagePlugin).not.toHaveBeenCalled();
    });

    it('returns state unchanged when status is not waiting_for_human (reject)', async () => {
      const state = makeState({ status: 'running' });

      const result = await handler.process(state, {
        rejectionReason: 'nope',
        toolMessageId: 'tool-msg-1',
      });

      expect(result.newState).toBe(state);
      expect(result.nextContext).toBeUndefined();
    });

    it('handles humanInput as out-of-scope (no state transition)', async () => {
      const state = makeState();

      const result = await handler.process(state, {
        humanInput: { response: 'hi' },
        toolMessageId: 'tool-msg-1',
      });

      expect(result.newState).toBe(state);
      expect(result.nextContext).toBeUndefined();
    });
  });
});
