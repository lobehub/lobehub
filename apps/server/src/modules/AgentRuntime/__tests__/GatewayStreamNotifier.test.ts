import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayStreamNotifier } from '../GatewayStreamNotifier';
import type { StreamChunkData } from '../StreamEventManager';
import type { IStreamEventManager } from '../types';

// Mock global fetch
const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
vi.stubGlobal('fetch', mockFetch);

function createMockInner(): IStreamEventManager & { calls: Record<string, any[][]> } {
  const calls: Record<string, any[][]> = {};

  const track = (name: string) => {
    calls[name] = [];
    return (...args: any[]) => {
      calls[name].push(args);
      return Promise.resolve(`${name}-result`);
    };
  };

  return {
    calls,
    cleanupOperation: track('cleanupOperation') as any,
    disconnect: track('disconnect') as any,
    getActiveOperationsCount: track('getActiveOperationsCount') as any,
    getStreamHistory: track('getStreamHistory') as any,
    publishAgentRuntimeEnd: track('publishAgentRuntimeEnd') as any,
    publishAgentRuntimeInit: track('publishAgentRuntimeInit') as any,
    publishStreamChunk: track('publishStreamChunk') as any,
    publishStreamEvent: track('publishStreamEvent') as any,
    readEventsOnce: track('readEventsOnce') as any,
    subscribeStreamEvents: track('subscribeStreamEvents') as any,
  };
}

describe('GatewayStreamNotifier', () => {
  let inner: ReturnType<typeof createMockInner>;
  let notifier: GatewayStreamNotifier;
  const gatewayUrl = 'https://gateway.test.com';
  const serviceToken = 'test-token';

  beforeEach(() => {
    vi.clearAllMocks();
    inner = createMockInner();
    notifier = new GatewayStreamNotifier(inner, gatewayUrl, serviceToken);
  });

  // ─── Publish methods: must always call inner first ───

  describe('publishStreamEvent', () => {
    it('delegates to inner and returns its result', async () => {
      const event = { data: { foo: 'bar' }, stepIndex: 0, type: 'step_start' as const };

      const result = await notifier.publishStreamEvent('op-1', event);

      expect(result).toBe('publishStreamEvent-result');
      expect(inner.calls.publishStreamEvent).toHaveLength(1);
      expect(inner.calls.publishStreamEvent[0]).toEqual(['op-1', event]);
    });

    it('pushes event to gateway via HTTP', async () => {
      await notifier.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'step_start' as const,
      });

      // Wait for fire-and-forget
      await new Promise((r) => setTimeout(r, 50));

      expect(mockFetch).toHaveBeenCalledWith(
        `${gatewayUrl}/api/operations/push-event`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${serviceToken}`,
          }),
          method: 'POST',
        }),
      );
    });

    it('awaits stream_end gateway push before resolving', async () => {
      let resolveFetch!: () => void;
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = () => resolve({ ok: true, text: () => Promise.resolve('') });
          }),
      );

      const result = notifier.publishStreamEvent('op-1', {
        data: { finalContent: 'final answer' },
        stepIndex: 0,
        type: 'stream_end' as const,
      });
      let resolved = false;
      void result.then(() => {
        resolved = true;
      });

      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledWith(
        `${gatewayUrl}/api/operations/push-event`,
        expect.objectContaining({ method: 'POST' }),
      );
      expect(resolved).toBe(false);

      resolveFetch();

      await expect(result).resolves.toBe('publishStreamEvent-result');
      expect(resolved).toBe(true);
    });

    it('still returns inner result even if gateway fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));

      const result = await notifier.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'step_start' as const,
      });

      expect(result).toBe('publishStreamEvent-result');
      expect(inner.calls.publishStreamEvent).toHaveLength(1);
    });
  });

  describe('publishStreamChunk', () => {
    it('delegates to inner and returns its result', async () => {
      const chunkData: StreamChunkData = { chunkType: 'text', content: 'hello' };

      const result = await notifier.publishStreamChunk('op-1', 0, chunkData);

      expect(result).toBe('publishStreamChunk-result');
      expect(inner.calls.publishStreamChunk).toHaveLength(1);
      expect(inner.calls.publishStreamChunk[0]).toEqual(['op-1', 0, chunkData]);
    });
  });

  describe('publishAgentRuntimeInit', () => {
    it('delegates to inner and returns its result', async () => {
      const initialState = { userId: 'user-1' };

      const result = await notifier.publishAgentRuntimeInit('op-1', initialState);

      expect(result).toBe('publishAgentRuntimeInit-result');
      expect(inner.calls.publishAgentRuntimeInit).toHaveLength(1);
      expect(inner.calls.publishAgentRuntimeInit[0]).toEqual(['op-1', initialState]);
    });

    it('calls gateway init and push-event endpoints', async () => {
      await notifier.publishAgentRuntimeInit('op-1', { userId: 'user-1' });

      await new Promise((r) => setTimeout(r, 50));

      const urls = mockFetch.mock.calls.map((c: any[]) => c[0]);
      expect(urls).toContain(`${gatewayUrl}/api/operations/init`);
      expect(urls).toContain(`${gatewayUrl}/api/operations/push-event`);
    });

    it('waits for gateway init before exposing the operation to subscribers', async () => {
      let resolveInit!: () => void;
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/api/operations/init')) {
          return new Promise((resolve) => {
            resolveInit = () => resolve({ ok: true, text: () => Promise.resolve('') });
          });
        }

        return Promise.resolve({ ok: true, text: () => Promise.resolve('') });
      });

      const result = notifier.publishAgentRuntimeInit('op-1', { userId: 'user-1' });
      let resolved = false;
      void result.then(() => {
        resolved = true;
      });

      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `${gatewayUrl}/api/operations/init`,
          expect.objectContaining({ method: 'POST' }),
        );
      });
      expect(resolved).toBe(false);
      expect(mockFetch.mock.calls.map((call: any[]) => call[0])).not.toContain(
        `${gatewayUrl}/api/operations/push-event`,
      );

      resolveInit();

      await expect(result).resolves.toBe('publishAgentRuntimeInit-result');
      expect(resolved).toBe(true);
      await vi.waitFor(() => {
        expect(mockFetch.mock.calls.map((call: any[]) => call[0])).toContain(
          `${gatewayUrl}/api/operations/push-event`,
        );
      });
    });

    it('does not drop the awaited init when the event lane is saturated', async () => {
      const pending: Array<{
        resolve: () => void;
        url: string;
      }> = [];
      mockFetch.mockImplementation(
        (url: string) =>
          new Promise((resolve) => {
            pending.push({
              resolve: () => resolve({ ok: true, text: () => Promise.resolve('') }),
              url,
            });
          }),
      );

      for (let index = 0; index < 20; index++) {
        await notifier.publishStreamEvent(`op-event-${index}`, {
          data: {},
          stepIndex: 0,
          type: 'step_start',
        });
      }
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(20));

      const result = notifier.publishAgentRuntimeInit('op-init', { userId: 'user-1' });
      let resolved = false;
      void result.then(() => {
        resolved = true;
      });

      await vi.waitFor(() => {
        expect(pending.some(({ url }) => url.endsWith('/api/operations/init'))).toBe(true);
      });
      expect(mockFetch).toHaveBeenCalledTimes(21);
      expect(resolved).toBe(false);

      pending.find(({ url }) => url.endsWith('/api/operations/init'))!.resolve();
      await expect(result).resolves.toBe('publishAgentRuntimeInit-result');

      for (const request of pending.filter(({ url }) =>
        url.endsWith('/api/operations/push-event'),
      )) {
        request.resolve();
      }
    });
  });

  describe('publishAgentRuntimeEnd', () => {
    it('delegates to inner and returns its result', async () => {
      const finalState = { status: 'done' };

      const params = {
        finalState,
        operationId: 'op-1',
        reason: 'completed',
        stepIndex: 2,
      };
      const result = await notifier.publishAgentRuntimeEnd(params);

      expect(result).toBe('publishAgentRuntimeEnd-result');
      expect(inner.calls.publishAgentRuntimeEnd).toHaveLength(1);
      expect(inner.calls.publishAgentRuntimeEnd[0]).toEqual([params]);
    });

    it('calls gateway push-event endpoint only (no update-status)', async () => {
      await notifier.publishAgentRuntimeEnd({
        finalState: {},
        operationId: 'op-1',
        reason: 'completed',
        reasonDetail: 'All done',
        stepIndex: 2,
      });

      await new Promise((r) => setTimeout(r, 50));

      const urls = mockFetch.mock.calls.map((c: any[]) => c[0]);
      expect(urls).toContain(`${gatewayUrl}/api/operations/push-event`);
      // Gateway handles session completion directly in pushEvent on agent_runtime_end
      expect(urls).not.toContain(`${gatewayUrl}/api/operations/update-status`);
    });

    it('computes effectiveReasonDetail when reasonDetail is omitted', async () => {
      const finalState = {
        error: {
          error: { message: 'Budget exceeded' },
          errorType: 'InsufficientBudgetForModel',
        },
      };

      await notifier.publishAgentRuntimeEnd({
        finalState,
        operationId: 'op-1',
        reason: 'error',
        stepIndex: 0,
      });
      await new Promise((r) => setTimeout(r, 50));

      const pushCall = mockFetch.mock.calls.find((c: any[]) => c[0].includes('push-event'));
      const body = JSON.parse(pushCall![1].body);
      expect(body.event.data.reasonDetail).toBe('Budget exceeded');
    });

    it('uses provided reasonDetail over computed one', async () => {
      const finalState = {
        error: { message: 'Some error' },
      };

      await notifier.publishAgentRuntimeEnd({
        finalState,
        operationId: 'op-1',
        reason: 'error',
        reasonDetail: 'Custom detail',
        stepIndex: 0,
      });
      await new Promise((r) => setTimeout(r, 50));

      const pushCall = mockFetch.mock.calls.find((c: any[]) => c[0].includes('push-event'));
      const body = JSON.parse(pushCall![1].body);
      expect(body.event.data.reasonDetail).toBe('Custom detail');
    });

    it('includes errorType from finalState.error.type', async () => {
      const finalState = {
        error: { message: 'Budget exceeded', type: 'InsufficientBudgetForModel' },
      };

      await notifier.publishAgentRuntimeEnd({
        finalState,
        operationId: 'op-1',
        reason: 'error',
        stepIndex: 0,
      });
      await new Promise((r) => setTimeout(r, 50));

      const pushCall = mockFetch.mock.calls.find((c: any[]) => c[0].includes('push-event'));
      const body = JSON.parse(pushCall![1].body);
      expect(body.event.data.errorType).toBe('InsufficientBudgetForModel');
    });

    it('includes errorType from finalState.error.errorType', async () => {
      const finalState = {
        error: {
          error: { message: 'Bad key' },
          errorType: 'InvalidProviderAPIKey',
        },
      };

      await notifier.publishAgentRuntimeEnd({
        finalState,
        operationId: 'op-1',
        reason: 'error',
        stepIndex: 0,
      });
      await new Promise((r) => setTimeout(r, 50));

      const pushCall = mockFetch.mock.calls.find((c: any[]) => c[0].includes('push-event'));
      const body = JSON.parse(pushCall![1].body);
      expect(body.event.data.errorType).toBe('InvalidProviderAPIKey');
    });

    it('errorType is undefined when no error in finalState', async () => {
      await notifier.publishAgentRuntimeEnd({
        finalState: { status: 'done' },
        operationId: 'op-1',
        reason: 'completed',
        stepIndex: 0,
      });
      await new Promise((r) => setTimeout(r, 50));

      const pushCall = mockFetch.mock.calls.find((c: any[]) => c[0].includes('push-event'));
      const body = JSON.parse(pushCall![1].body);
      expect(body.event.data.errorType).toBeUndefined();
    });

    it('forwards uiMessages to the gateway push payload when provided', async () => {
      const uiMessages = [{ id: 'msg_z', role: 'assistantGroup' }] as any;

      await notifier.publishAgentRuntimeEnd({
        finalState: { status: 'done' },
        operationId: 'op-1',
        reason: 'completed',
        stepIndex: 4,
        uiMessages,
      });
      await new Promise((r) => setTimeout(r, 50));

      const pushCall = mockFetch.mock.calls.find((c: any[]) => c[0].includes('push-event'));
      const body = JSON.parse(pushCall![1].body);
      expect(body.event.data.uiMessages).toEqual(uiMessages);
    });

    it('omits uiMessages from the gateway push payload when not provided', async () => {
      await notifier.publishAgentRuntimeEnd({
        finalState: { status: 'done' },
        operationId: 'op-1',
        reason: 'completed',
        stepIndex: 4,
      });
      await new Promise((r) => setTimeout(r, 50));

      const pushCall = mockFetch.mock.calls.find((c: any[]) => c[0].includes('push-event'));
      const body = JSON.parse(pushCall![1].body);
      expect(body.event.data).not.toHaveProperty('uiMessages');
    });
  });

  // ─── LOBE-11930: shared-agent visitor runs must not leak the creator's
  //     raw operation metadata / AgentState over the visitor's WS channel ───

  describe('shared-agent visitor privacy (agent_runtime_init)', () => {
    const pushInitPayload = () => {
      const pushCall = mockFetch.mock.calls.find(
        (c: any[]) =>
          c[0].includes('push-event') && JSON.parse(c[1].body).event.type === 'agent_runtime_init',
      );
      return JSON.parse(pushCall![1].body).event.data;
    };

    it('strips agentConfig/modelRuntimeConfig/userId/workspaceId when streamOwnerUserId is set (share run)', async () => {
      await notifier.publishAgentRuntimeInit('op-share', {
        agentConfig: { systemRole: 'secret system prompt' },
        modelRuntimeConfig: { model: 'gpt-4', provider: 'openai' },
        status: 'idle',
        streamOwnerUserId: 'visitor-1',
        userId: 'creator-1',
        workspaceId: 'ws-1',
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushInitPayload();
      expect(data).toEqual({ status: 'idle' });
      expect(data).not.toHaveProperty('agentConfig');
      expect(data).not.toHaveProperty('modelRuntimeConfig');
      expect(data).not.toHaveProperty('userId');
      expect(data).not.toHaveProperty('workspaceId');
      expect(data).not.toHaveProperty('streamOwnerUserId');
    });

    it('forwards the full metadata unchanged for a normal (non-share) creator run', async () => {
      const initialState = {
        agentConfig: { systemRole: 'my system prompt' },
        modelRuntimeConfig: { model: 'gpt-4', provider: 'openai' },
        status: 'idle',
        userId: 'creator-1',
        workspaceId: 'ws-1',
      };

      await notifier.publishAgentRuntimeInit('op-owner', initialState);
      await new Promise((r) => setTimeout(r, 50));

      expect(pushInitPayload()).toEqual(initialState);
    });
  });

  describe('shared-agent visitor privacy (agent_runtime_end)', () => {
    const pushEndPayload = () => {
      const pushCall = mockFetch.mock.calls.find(
        (c: any[]) =>
          c[0].includes('push-event') && JSON.parse(c[1].body).event.type === 'agent_runtime_end',
      );
      return JSON.parse(pushCall![1].body).event.data;
    };

    it('drops finalState (userMemory/agentConfig/systemRole/...) but keeps reason for a share run, projects errorType to the public bucket, and scrubs uiMessages of creator identity', async () => {
      const uiMessages = [
        {
          content: 'hi',
          extra: { model: 'gpt-4', provider: 'openai' },
          id: 'msg_1',
          role: 'assistant',
          sender: { id: 'creator-1', nickname: 'Creator' },
          usage: { totalTokens: 42 },
        },
      ] as any;

      // `InsufficientBudgetForModel` — the creator's OWN budget/plan state —
      // is exactly the class of code `sanitizeVisitorError` must not forward
      // verbatim (LOBE-11930 Codex P2, round 3, message.ts:432): a visitor
      // who triggers it would otherwise learn the creator ran out of budget.
      await notifier.publishAgentRuntimeEnd({
        finalState: {
          error: {
            message: 'LobeHub Cloud balance is too low',
            type: 'InsufficientBudgetForModel',
          },
          metadata: {
            agentConfig: { systemRole: 'secret system prompt' },
            agentShare: { agentId: 'agent-1', visitorUserId: 'visitor-1' },
            userMemory: { persona: 'creator private persona' },
          },
          status: 'error',
          systemRole: 'secret system prompt',
          userInterventionConfig: { autoApprove: true },
        },
        operationId: 'op-share',
        reason: 'error',
        stepIndex: 3,
        uiMessages,
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushEndPayload();
      expect(data).not.toHaveProperty('finalState');
      expect(data.reason).toBe('error');
      // Projected to the generic public bucket, not the creator's real code.
      expect(data.errorType).toBe('AgentRuntimeError');
      expect(data.reasonDetail).not.toContain('balance');
      expect(data.uiMessages).toHaveLength(1);
      expect(data.uiMessages[0]).toMatchObject({
        content: 'hi',
        id: 'msg_1',
        role: 'assistant',
        sender: null,
      });
      expect(data.uiMessages[0].usage).toBeUndefined();
      expect(data.uiMessages[0].extra?.model).toBeUndefined();
      expect(data.uiMessages[0].extra?.provider).toBeUndefined();
      expect(JSON.stringify(data)).not.toContain('secret system prompt');
      expect(JSON.stringify(data)).not.toContain('creator private persona');
      expect(JSON.stringify(data)).not.toContain('Creator');
      expect(JSON.stringify(data)).not.toContain('gpt-4');
      expect(JSON.stringify(data)).not.toContain('balance');
    });

    it('forwards type + message verbatim for a share-purpose-built safe error code (ShareTurnLimitExceeded)', async () => {
      await notifier.publishAgentRuntimeEnd({
        finalState: {
          error: {
            message: 'Reached the turn limit for this topic.',
            type: 'ShareTurnLimitExceeded',
          },
          metadata: {
            agentShare: { agentId: 'agent-1', visitorUserId: 'visitor-1' },
          },
          status: 'error',
        },
        operationId: 'op-share-safe',
        reason: 'error',
        stepIndex: 3,
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushEndPayload();
      expect(data.errorType).toBe('ShareTurnLimitExceeded');
      expect(data.reasonDetail).toBe('Reached the turn limit for this topic.');
    });

    it('projects a provider-biz error (invalid key / upstream failure) to the public bucket for a share run', async () => {
      await notifier.publishAgentRuntimeEnd({
        finalState: {
          error: {
            body: { budget: { remaining: 0 }, provider: 'openai', traceId: 'trace-abc' },
            message: 'OpenAI API key invalid: sk-***',
            type: 'InvalidProviderAPIKey',
          },
          metadata: {
            agentShare: { agentId: 'agent-1', visitorUserId: 'visitor-1' },
          },
          status: 'error',
        },
        operationId: 'op-share-provider-error',
        reason: 'error',
        stepIndex: 3,
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushEndPayload();
      expect(data.errorType).toBe('AgentRuntimeError');
      const serialized = JSON.stringify(data);
      expect(serialized).not.toContain('openai');
      expect(serialized).not.toContain('sk-***');
      expect(serialized).not.toContain('trace-abc');
      expect(serialized).not.toContain('budget');
    });

    it('keeps uiMessages (including sender/usage/model) unchanged for a normal (non-share) creator run', async () => {
      const uiMessages = [
        {
          content: 'hi',
          extra: { model: 'gpt-4', provider: 'openai' },
          id: 'msg_1',
          role: 'assistant',
          sender: { id: 'creator-1', nickname: 'Creator' },
          usage: { totalTokens: 42 },
        },
      ] as any;

      await notifier.publishAgentRuntimeEnd({
        finalState: { status: 'done' },
        operationId: 'op-owner',
        reason: 'completed',
        stepIndex: 3,
        uiMessages,
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushEndPayload();
      expect(data.uiMessages).toEqual(uiMessages);
    });

    it('keeps finalState (including metadata) unchanged for a normal (non-share) creator run', async () => {
      const finalState = {
        metadata: { userMemory: { persona: 'creator persona' } },
        status: 'done',
        systemRole: 'my system prompt',
      };

      await notifier.publishAgentRuntimeEnd({
        finalState,
        operationId: 'op-owner',
        reason: 'completed',
        stepIndex: 3,
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushEndPayload();
      expect(data.finalState).toEqual(finalState);
    });
  });

  describe('shared-agent visitor privacy (step_complete / generic publishStreamEvent)', () => {
    const pushStepCompletePayload = () => {
      const pushCall = mockFetch.mock.calls.find(
        (c: any[]) =>
          c[0].includes('push-event') && JSON.parse(c[1].body).event.type === 'step_complete',
      );
      return JSON.parse(pushCall![1].body).event.data;
    };

    it('drops finalState (agentConfig/userMemory/systemRole) from a step_complete event for a share run, keeping other fields', async () => {
      await notifier.publishStreamEvent('op-share', {
        data: {
          finalState: {
            metadata: {
              agentConfig: { systemRole: 'secret system prompt' },
              agentShare: { agentId: 'agent-1', visitorUserId: 'visitor-1' },
              userMemory: { persona: 'creator private persona' },
            },
            status: 'running',
            systemRole: 'secret system prompt',
            userInterventionConfig: { autoApprove: true },
          },
          nextStepScheduled: false,
          stepIndex: 2,
        },
        stepIndex: 2,
        type: 'step_complete' as const,
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushStepCompletePayload();
      expect(data).not.toHaveProperty('finalState');
      expect(data.nextStepScheduled).toBe(false);
      expect(data.stepIndex).toBe(2);
      expect(JSON.stringify(data)).not.toContain('secret system prompt');
      expect(JSON.stringify(data)).not.toContain('creator private persona');
    });

    it('keeps finalState (including metadata) unchanged in a step_complete event for a normal (non-share) creator run', async () => {
      const finalState = {
        metadata: { userMemory: { persona: 'creator persona' } },
        status: 'running',
        systemRole: 'my system prompt',
      };

      await notifier.publishStreamEvent('op-owner', {
        data: { finalState, nextStepScheduled: false, stepIndex: 1 },
        stepIndex: 1,
        type: 'step_complete' as const,
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushStepCompletePayload();
      expect(data.finalState).toEqual(finalState);
    });
  });

  // step_start carries neither `streamOwnerUserId` (only on the init event's
  // `initialState`) nor `finalState` (only on end / step_complete), so it can
  // only be sanitized via the per-operation share-visitor flag `pushEvent`
  // tracks from `publishAgentRuntimeInit` / `publishAgentRuntimeEnd`.
  describe('shared-agent visitor privacy (step_start uiMessages)', () => {
    const pushStepStartPayload = () => {
      const pushCall = mockFetch.mock.calls.find(
        (c: any[]) =>
          c[0].includes('push-event') && JSON.parse(c[1].body).event.type === 'step_start',
      );
      return JSON.parse(pushCall![1].body).event.data;
    };

    const uiMessage = {
      content: 'hi',
      extra: { model: 'gpt-4', provider: 'openai' },
      id: 'msg_1',
      role: 'assistant',
      sender: { id: 'creator-1', nickname: 'Creator' },
      usage: { totalTokens: 42 },
    } as any;

    it('scrubs sender/usage/extra.model/extra.provider off uiMessages for a share run', async () => {
      await notifier.publishAgentRuntimeInit('op-share', {
        status: 'idle',
        streamOwnerUserId: 'visitor-1',
        userId: 'creator-1',
      });

      await notifier.publishStreamEvent('op-share', {
        data: { uiMessages: [uiMessage] },
        stepIndex: 1,
        type: 'step_start' as const,
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushStepStartPayload();
      expect(data.uiMessages).toHaveLength(1);
      expect(data.uiMessages[0]).toMatchObject({
        content: 'hi',
        id: 'msg_1',
        role: 'assistant',
        sender: null,
      });
      expect(data.uiMessages[0].usage).toBeUndefined();
      expect(data.uiMessages[0].extra?.model).toBeUndefined();
      expect(data.uiMessages[0].extra?.provider).toBeUndefined();
      expect(JSON.stringify(data)).not.toContain('Creator');
      expect(JSON.stringify(data)).not.toContain('gpt-4');
    });

    it('keeps uiMessages (including sender/usage/model) unchanged for a normal (non-share) creator run', async () => {
      await notifier.publishAgentRuntimeInit('op-owner', {
        status: 'idle',
        userId: 'creator-1',
      });

      await notifier.publishStreamEvent('op-owner', {
        data: { uiMessages: [uiMessage] },
        stepIndex: 1,
        type: 'step_start' as const,
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushStepStartPayload();
      expect(data.uiMessages).toEqual([uiMessage]);
    });

    it('queue worker path: scrubs uiMessages when the persisted resolver reports a share run for an op it never initialized', async () => {
      const resolveShareVisitor = vi.fn(async (op: string) => op === 'op-share-q');
      const workerNotifier = new GatewayStreamNotifier(
        inner,
        gatewayUrl,
        serviceToken,
        undefined,
        resolveShareVisitor,
      );

      await workerNotifier.publishStreamEvent('op-share-q', {
        data: { uiMessages: [uiMessage] },
        stepIndex: 1,
        type: 'step_start' as const,
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(resolveShareVisitor).toHaveBeenCalledWith('op-share-q');
      const data = pushStepStartPayload();
      expect(data.uiMessages[0].sender).toBeNull();
      expect(data.uiMessages[0].usage).toBeUndefined();
    });

    it('queue worker path: fails closed (still scrubs) when the persisted resolver rejects', async () => {
      const resolveShareVisitor = vi.fn(async () => {
        throw new Error('metadata read failed');
      });
      const workerNotifier = new GatewayStreamNotifier(
        inner,
        gatewayUrl,
        serviceToken,
        undefined,
        resolveShareVisitor,
      );

      await workerNotifier.publishStreamEvent('op-unknown-q', {
        data: { uiMessages: [uiMessage] },
        stepIndex: 1,
        type: 'step_start' as const,
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushStepStartPayload();
      expect(data.uiMessages[0].sender).toBeNull();
    });

    it('queue worker path: does not scrub uiMessages when the persisted resolver reports a normal run', async () => {
      const resolveShareVisitor = vi.fn(async () => false);
      const workerNotifier = new GatewayStreamNotifier(
        inner,
        gatewayUrl,
        serviceToken,
        undefined,
        resolveShareVisitor,
      );

      await workerNotifier.publishStreamEvent('op-plain-q', {
        data: { uiMessages: [uiMessage] },
        stepIndex: 1,
        type: 'step_start' as const,
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushStepStartPayload();
      expect(data.uiMessages).toEqual([uiMessage]);
    });
  });

  // ─── LOBE-11930 Codex P2 (round 3, message.ts:432): the live `type: 'error'`
  //     Gateway stream event (`ServerStreamSink.publishError` →
  //     `formatErrorEventData`) carries the same raw `{ body, error, errorType }`
  //     shape as a persisted `ChatMessageError`, but never goes through
  //     `toVisitorMessage` — it is pushed straight to the visitor's WS channel
  //     mid-run, before any DB row exists. Redacting the stored copy alone
  //     would leave this live path leaking provider/budget/upstream details. ───

  describe('shared-agent visitor privacy (live error stream event)', () => {
    const pushErrorPayload = () => {
      const pushCall = mockFetch.mock.calls.find(
        (c: any[]) => c[0].includes('push-event') && JSON.parse(c[1].body).event.type === 'error',
      );
      return JSON.parse(pushCall![1].body).event.data;
    };

    it('strips body (provider/budget/upstream diagnostic) and projects errorType for a share run', async () => {
      await notifier.publishAgentRuntimeInit('op-share-live-error', {
        status: 'idle',
        streamOwnerUserId: 'visitor-1',
        userId: 'creator-1',
      });

      await notifier.publishStreamEvent('op-share-live-error', {
        data: {
          body: { budget: { remaining: 0 }, provider: 'anthropic', traceId: 'trace-xyz' },
          error: 'Anthropic API key invalid',
          errorType: 'InvalidProviderAPIKey',
          phase: 'llm_call',
        },
        stepIndex: 1,
        type: 'error' as const,
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushErrorPayload();
      expect(data.errorType).toBe('AgentRuntimeError');
      expect(data).not.toHaveProperty('body');
      const serialized = JSON.stringify(data);
      expect(serialized).not.toContain('anthropic');
      expect(serialized).not.toContain('API key invalid');
      expect(serialized).not.toContain('trace-xyz');
      expect(serialized).not.toContain('budget');
    });

    it('keeps a share-purpose-built safe error code verbatim on the live event', async () => {
      await notifier.publishAgentRuntimeInit('op-share-live-safe', {
        status: 'idle',
        streamOwnerUserId: 'visitor-1',
        userId: 'creator-1',
      });

      await notifier.publishStreamEvent('op-share-live-safe', {
        data: {
          error: 'This shared agent uses a provider that is not supported for shared visitors.',
          errorType: 'AgentShareProviderNotSupported',
          phase: 'setup',
        },
        stepIndex: 0,
        type: 'error' as const,
      });
      await new Promise((r) => setTimeout(r, 50));

      const data = pushErrorPayload();
      expect(data.errorType).toBe('AgentShareProviderNotSupported');
      expect(data.error).toBe(
        'This shared agent uses a provider that is not supported for shared visitors.',
      );
    });

    it('keeps the raw error event unchanged for a normal (non-share) creator run', async () => {
      await notifier.publishAgentRuntimeInit('op-owner-live-error', {
        status: 'idle',
        userId: 'creator-1',
      });

      const rawData = {
        body: { provider: 'anthropic' },
        error: 'Anthropic API key invalid',
        errorType: 'InvalidProviderAPIKey',
        phase: 'llm_call',
      };
      await notifier.publishStreamEvent('op-owner-live-error', {
        data: rawData,
        stepIndex: 1,
        type: 'error' as const,
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(pushErrorPayload()).toEqual(rawData);
    });
  });

  // ─── Read/subscribe methods: must delegate directly to inner ───

  describe('subscribeStreamEvents', () => {
    it('delegates directly to inner', async () => {
      const onEvents = vi.fn();
      const signal = new AbortController().signal;

      await notifier.subscribeStreamEvents('op-1', '0', onEvents, signal);

      expect(inner.calls.subscribeStreamEvents).toHaveLength(1);
      expect(inner.calls.subscribeStreamEvents[0]).toEqual(['op-1', '0', onEvents, signal]);
    });

    it('does not call gateway', async () => {
      await notifier.subscribeStreamEvents('op-1', '0', vi.fn());

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('getStreamHistory', () => {
    it('delegates directly to inner', async () => {
      await notifier.getStreamHistory('op-1', 50);

      expect(inner.calls.getStreamHistory).toHaveLength(1);
      expect(inner.calls.getStreamHistory[0]).toEqual(['op-1', 50]);
    });
  });

  describe('cleanupOperation', () => {
    it('delegates directly to inner', async () => {
      await notifier.cleanupOperation('op-1');

      expect(inner.calls.cleanupOperation).toHaveLength(1);
    });
  });

  describe('getActiveOperationsCount', () => {
    it('delegates directly to inner', async () => {
      await notifier.getActiveOperationsCount();

      expect(inner.calls.getActiveOperationsCount).toHaveLength(1);
    });
  });

  describe('disconnect', () => {
    it('delegates directly to inner', async () => {
      await notifier.disconnect();

      expect(inner.calls.disconnect).toHaveLength(1);
    });
  });

  // ─── Gateway failure resilience ───

  describe('gateway failure does not affect inner', () => {
    it('publishStreamEvent succeeds when gateway is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('connection refused'));

      const result = await notifier.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'step_start' as const,
      });

      expect(result).toBe('publishStreamEvent-result');
      expect(inner.calls.publishStreamEvent).toHaveLength(1);
    });

    it('publishAgentRuntimeInit succeeds when gateway returns 500', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => 'Internal Error' });

      const result = await notifier.publishAgentRuntimeInit('op-1', { userId: 'u1' });

      expect(result).toBe('publishAgentRuntimeInit-result');
      expect(inner.calls.publishAgentRuntimeInit).toHaveLength(1);
    });

    it('publishAgentRuntimeEnd succeeds when gateway times out', async () => {
      mockFetch.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10)),
      );

      const result = await notifier.publishAgentRuntimeEnd({
        finalState: {},
        operationId: 'op-1',
        reason: 'completed',
        stepIndex: 0,
      });

      expect(result).toBe('publishAgentRuntimeEnd-result');
      expect(inner.calls.publishAgentRuntimeEnd).toHaveLength(1);
    });
  });

  // ─── Timeout and concurrency ───

  describe('timeout and concurrency control', () => {
    it('passes AbortSignal to fetch', async () => {
      await notifier.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'step_start' as const,
      });

      await new Promise((r) => setTimeout(r, 50));

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].signal).toBeInstanceOf(AbortSignal);
    });

    it('drops requests when max inflight is reached', async () => {
      // Hold all fetches pending
      const resolvers: Array<() => void> = [];
      mockFetch.mockImplementation(
        () =>
          new Promise<{ ok: boolean }>((resolve) => {
            resolvers.push(() => resolve({ ok: true }));
          }),
      );

      // Fire 25 events (max inflight is 20)
      for (let i = 0; i < 25; i++) {
        notifier.publishStreamEvent(`op-${i}`, {
          data: {},
          stepIndex: 0,
          type: 'step_start' as const,
        });
      }

      await new Promise((r) => setTimeout(r, 50));

      // Only 20 should have actually called fetch
      expect(mockFetch).toHaveBeenCalledTimes(20);

      // Release all pending
      for (const r of resolvers) r();
    });

    it('uses url-join for URL construction', async () => {
      await notifier.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'step_start' as const,
      });

      await new Promise((r) => setTimeout(r, 50));

      const url = mockFetch.mock.calls[0][0];
      expect(url).toBe(`${gatewayUrl}/api/operations/push-event`);
      // No double slashes
      expect(url).not.toContain('//api');
    });
  });

  describe('sendToolExecute', () => {
    const toolExecuteData = {
      apiName: 'readFile',
      arguments: '{"path":"/tmp/x"}',
      executionTimeoutMs: 30_000,
      identifier: 'local-system',
      toolCallId: 'call-1',
    };

    beforeEach(() => {
      // Earlier tests in this file install hanging mockImplementations that
      // clearAllMocks doesn't reset — restore the default behavior here.
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    });

    it('POSTs to /api/operations/tool-execute with the expected payload', async () => {
      await notifier.sendToolExecute('op-1', toolExecuteData);

      const calls = mockFetch.mock.calls.filter((c: any[]) =>
        String(c[0]).includes('/api/operations/tool-execute'),
      );
      expect(calls).toHaveLength(1);

      const [url, init] = calls[0];
      expect(url).toBe(`${gatewayUrl}/api/operations/tool-execute`);
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe(`Bearer ${serviceToken}`);
      expect(JSON.parse(init.body)).toEqual({
        data: toolExecuteData,
        operationId: 'op-1',
      });
    });

    it('rejects when the gateway returns a non-ok status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: () => Promise.resolve('bad gateway'),
      });

      await expect(notifier.sendToolExecute('op-1', toolExecuteData)).rejects.toThrow(/502/);
    });

    it('rejects when fetch throws (network / timeout)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network down'));

      await expect(notifier.sendToolExecute('op-1', toolExecuteData)).rejects.toThrow(
        'network down',
      );
    });
  });

  // ─── Single-connection multiplexing: mirror member events to supervisor op ───

  describe('mirrorToOperationId (single-connection multiplexing)', () => {
    const pushEventCalls = () =>
      mockFetch.mock.calls
        .filter(([url]) => String(url).endsWith('/api/operations/push-event'))
        .map(([, init]) => JSON.parse((init as { body: string }).body));

    it('mirrors a member op stream event to the supervisor channel, keeping the event operationId', async () => {
      await notifier.publishAgentRuntimeInit('op-member', { mirrorToOperationId: 'op-supervisor' });

      await notifier.publishStreamChunk('op-member', 0, {
        chunkType: 'text',
        content: 'hi',
      } as StreamChunkData);

      await new Promise((r) => setTimeout(r, 50));

      const pushes = pushEventCalls().filter((b) => b.event?.type === 'stream_chunk');
      // Delivered to BOTH the member channel and the supervisor channel.
      expect(pushes.map((p) => p.operationId).sort()).toEqual(['op-member', 'op-supervisor']);
      // Event payload keeps the member operationId so the client demuxes correctly.
      for (const p of pushes) expect(p.event.operationId).toBe('op-member');
    });

    it('does not mirror when no mirrorToOperationId was registered', async () => {
      await notifier.publishAgentRuntimeInit('op-solo', { userId: 'u1' });

      await notifier.publishStreamChunk('op-solo', 0, {
        chunkType: 'text',
        content: 'hi',
      } as StreamChunkData);

      await new Promise((r) => setTimeout(r, 50));

      const pushes = pushEventCalls().filter((b) => b.event?.type === 'stream_chunk');
      expect(pushes.map((p) => p.operationId)).toEqual(['op-solo']);
    });

    it('ignores a self-referential mirror target', async () => {
      await notifier.publishAgentRuntimeInit('op-x', { mirrorToOperationId: 'op-x' });

      await notifier.publishStreamChunk('op-x', 0, {
        chunkType: 'text',
        content: 'hi',
      } as StreamChunkData);

      await new Promise((r) => setTimeout(r, 50));

      const pushes = pushEventCalls().filter((b) => b.event?.type === 'stream_chunk');
      expect(pushes.map((p) => p.operationId)).toEqual(['op-x']);
    });

    it('queue worker path: lazily resolves the mirror target from persisted metadata', async () => {
      // Worker notifier never ran init for this op, so its in-process map is empty.
      const resolve = vi.fn(async (op: string) =>
        op === 'op-member-q' ? 'op-supervisor-q' : undefined,
      );
      const workerNotifier = new GatewayStreamNotifier(inner, gatewayUrl, serviceToken, resolve);

      await workerNotifier.publishStreamChunk('op-member-q', 0, {
        chunkType: 'text',
        content: 'streamed-by-worker',
      } as StreamChunkData);

      await new Promise((r) => setTimeout(r, 50));

      const pushes = pushEventCalls().filter(
        (b) => b.event?.data?.content === 'streamed-by-worker',
      );
      expect(pushes.map((p) => p.operationId).sort()).toEqual(['op-member-q', 'op-supervisor-q']);

      // Resolution is cached: a second event does not re-read metadata.
      await workerNotifier.publishStreamChunk('op-member-q', 1, {
        chunkType: 'text',
        content: 'second',
      } as StreamChunkData);
      await new Promise((r) => setTimeout(r, 50));
      expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('queue worker path: an op with no persisted mirror target is not mirrored', async () => {
      const resolve = vi.fn(async () => undefined);
      const workerNotifier = new GatewayStreamNotifier(inner, gatewayUrl, serviceToken, resolve);

      await workerNotifier.publishStreamChunk('op-plain', 0, {
        chunkType: 'text',
        content: 'plain',
      } as StreamChunkData);
      await new Promise((r) => setTimeout(r, 50));

      const pushes = pushEventCalls().filter((b) => b.event?.data?.content === 'plain');
      expect(pushes.map((p) => p.operationId)).toEqual(['op-plain']);
    });

    it('stops mirroring after the member op reaches a terminal state', async () => {
      await notifier.publishAgentRuntimeInit('op-member', { mirrorToOperationId: 'op-supervisor' });

      await notifier.publishAgentRuntimeEnd({
        finalState: {} as any,
        operationId: 'op-member',
        reason: 'completed',
        stepIndex: 1,
      });

      // A late event after terminal must not mirror anymore.
      await notifier.publishStreamChunk('op-member', 2, {
        chunkType: 'text',
        content: 'late',
      } as StreamChunkData);

      await new Promise((r) => setTimeout(r, 50));

      const lateChunk = pushEventCalls().filter(
        (b) => b.event?.type === 'stream_chunk' && b.event?.data?.content === 'late',
      );
      expect(lateChunk.map((p) => p.operationId)).toEqual(['op-member']);
    });
  });
});
