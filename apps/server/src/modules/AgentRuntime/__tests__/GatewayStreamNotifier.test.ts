import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayStreamNotifier } from '../GatewayStreamNotifier';
import { FULL_STRIP_REDACTION, sanitizeGatewayEventData } from '../gatewayVisitorRedaction';
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
    // `clearAllMocks` keeps implementations, so a test that installs a fetch
    // that never resolves would otherwise hang whichever test runs next.
    mockFetch.mockReset().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
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

    it.each([undefined, 'execution_complete'])(
      'omits unused step_complete state from gateway payloads (phase=%s)',
      async (phase) => {
        const finalState = {
          initialContext: { systemRole: 'system context' },
          plan: { tools: ['tool'] },
          status: 'done',
          world: { agent: { name: 'agent' } },
        };
        const data = {
          finalState,
          nextStepScheduled: false,
          ...(phase && { phase, reason: 'done', reasonDetail: 'Finished' }),
          stepIndex: 2,
        };

        await notifier.publishStreamEvent('op-1', {
          data,
          stepIndex: 2,
          type: 'step_complete',
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        const { finalState: _finalState, ...expected } = data;
        expect(body.event.data).toEqual(expected);
        expect(body.event.data).not.toHaveProperty('finalState');
        // The notifier must not mutate the runtime state passed by its caller.
        expect(inner.calls.publishStreamEvent[0][1].data.finalState).toBe(finalState);
        expect(data.finalState).toBe(finalState);
      },
    );

    it('projects the tool_end result onto the wire without touching the inner copy', async () => {
      const result = {
        content: 'THE WHOLE PAGE'.repeat(500),
        state: {
          results: [{ crawler: 'naive', data: { content: 'x'.repeat(5000) }, url: 'https://a' }],
        },
        success: true,
      };
      const data = {
        executionTime: 42,
        isSuccess: true,
        payload: {
          parentMessageId: 'msg-1',
          toolCalling: { apiName: 'crawlSinglePage', identifier: 'lobe-web-browsing' },
        },
        result,
      };

      await notifier.publishStreamEvent('op-1', { data, stepIndex: 1, type: 'tool_end' });

      const pushed = JSON.parse(mockFetch.mock.calls[0][1].body).event.data;
      expect(pushed.result).not.toHaveProperty('content');
      expect(pushed.result.success).toBe(true);
      expect(pushed.isSuccess).toBe(true);
      expect(pushed.executionTime).toBe(42);
      expect(pushed.result.state.results[0].data.content.length).toBeLessThan(5000);
      // In-process consumers (Responses API, recorded steps) keep the real body.
      expect(inner.calls.publishStreamEvent[0][1].data.result).toBe(result);
      expect(data.result.content).toBe(result.content);
    });

    it('keeps a shell result body, whose renderer-side hook parses it', async () => {
      const data = {
        isSuccess: true,
        payload: { toolCalling: { apiName: 'runCommand', identifier: 'lobe-local-system' } },
        result: { content: 'Switched to branch feat/x', state: { exitCode: 0 }, success: true },
      };

      await notifier.publishStreamEvent('op-1', { data, stepIndex: 1, type: 'tool_end' });

      const pushed = JSON.parse(mockFetch.mock.calls[0][1].body).event.data;
      expect(pushed.result.content).toBe('Switched to branch feat/x');
      expect(pushed.result.state.exitCode).toBe(0);
    });

    it('ships stream_end with only what the wire reads', async () => {
      const data = {
        finalContent: 'the answer',
        grounding: { citations: [1, 2] },
        imageList: [{ id: 'img-1' }],
        reasoning: 'x'.repeat(9000),
        stepLabel: 'Step 2',
        toolsCalling: [{ id: 'call-1' }],
        usage: { total_tokens: 500 },
      };

      await notifier.publishStreamEvent('op-1', { data, stepIndex: 1, type: 'stream_end' });
      await notifier.drainPushes('op-1');

      const pushed = JSON.parse(mockFetch.mock.calls[0][1].body).event.data;
      expect(pushed).toEqual({ finalContent: 'the answer', stepLabel: 'Step 2' });
      // In-process consumers (Responses API, the CLI) keep the whole payload.
      expect(inner.calls.publishStreamEvent[0][1].data).toBe(data);
    });

    it('keeps an absent finalContent absent rather than inventing one', async () => {
      const data = { reasoning: 'dropped', toolsCalling: [] };

      await notifier.publishStreamEvent('op-1', { data, stepIndex: 1, type: 'stream_end' });
      await notifier.drainPushes('op-1');

      expect(JSON.parse(mockFetch.mock.calls[0][1].body).event.data).toEqual({});
    });

    it('leaves other event types carrying their result body', async () => {
      const data = { result: { content: 'kept' } };

      await notifier.publishStreamEvent('op-1', { data, stepIndex: 1, type: 'step_start' });

      expect(JSON.parse(mockFetch.mock.calls[0][1].body).event.data.result.content).toBe('kept');
    });

    it('forwards opted-in step state without bypassing visitor redaction', async () => {
      const finalState = {
        host: { includeFinalState: true },
        initialContext: { prompt: 'context' },
        messages: [{ content: 'history' }],
        status: 'done',
      };
      const data = { finalState, phase: 'execution_complete', reason: 'done' };
      await notifier.publishStreamEvent('op-1', { data, stepIndex: 2, type: 'step_complete' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.event.data.finalState).toEqual({
        host: { includeFinalState: true },
        initialContext: { prompt: 'context' },
        status: 'done',
      });
      expect(sanitizeGatewayEventData(data, FULL_STRIP_REDACTION, 'step_complete')).toEqual({
        phase: 'execution_complete',
        reason: 'done',
      });
    });

    it('waits for the stream_end gateway push unless the caller defers pushes', async () => {
      // Request-scoped callers (hetero ingest, routers) never drain, so the
      // push must land before publishStreamEvent resolves.
      let resolveFetch!: () => void;
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = () => resolve({ ok: true, text: () => Promise.resolve('') });
          }),
      );

      let published = false;
      const publish = notifier
        .publishStreamEvent('op-1', {
          data: { finalContent: 'final answer' },
          stepIndex: 0,
          type: 'stream_end' as const,
        })
        .then(() => {
          published = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(published).toBe(false);

      resolveFetch();
      await publish;
      expect(published).toBe(true);
    });

    it('does not wait for the stream_end gateway push when deferred, but drainPushes does', async () => {
      const notifier = new GatewayStreamNotifier(
        inner,
        gatewayUrl,
        serviceToken,
        undefined,
        undefined,
        { deferPushes: true },
      );
      let resolveFetch!: () => void;
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = () => resolve({ ok: true, text: () => Promise.resolve('') });
          }),
      );

      // The step publishes and moves on: the push is ordered, not awaited.
      await expect(
        notifier.publishStreamEvent('op-1', {
          data: { finalContent: 'final answer' },
          stepIndex: 0,
          type: 'stream_end' as const,
        }),
      ).resolves.toBe('publishStreamEvent-result');

      let drained = false;
      const drain = notifier.drainPushes('op-1').then(() => {
        drained = true;
      });
      await Promise.resolve();
      expect(drained).toBe(false);

      resolveFetch();
      await drain;
      expect(drained).toBe(true);
    });

    it('keeps a barrier behind the pushes issued before it, and ahead of later ones', async () => {
      const notifier = new GatewayStreamNotifier(
        inner,
        gatewayUrl,
        serviceToken,
        undefined,
        undefined,
        { deferPushes: true },
      );
      const order: string[] = [];
      let releaseChunk!: () => void;
      mockFetch.mockImplementation((_url: string, init: { body: string }) => {
        const { type } = JSON.parse(init.body).event;
        if (type === 'stream_chunk') {
          return new Promise((resolve) => {
            releaseChunk = () => {
              order.push('stream_chunk');
              resolve({ ok: true, text: () => Promise.resolve('') });
            };
          });
        }
        order.push(type);
        return Promise.resolve({ ok: true, text: () => Promise.resolve('') });
      });

      await notifier.publishStreamChunk('op-1', 0, { chunkType: 'text' } as StreamChunkData);
      await notifier.publishStreamEvent('op-1', {
        data: { finalContent: 'done' },
        stepIndex: 0,
        type: 'stream_end',
      });
      await notifier.publishStreamEvent('op-1', { data: {}, stepIndex: 1, type: 'step_start' });

      // Nothing may pass the barrier while the chunk it waits for is in flight.
      await Promise.resolve();
      expect(order).toEqual([]);

      releaseChunk();
      await notifier.drainPushes('op-1');

      expect(order).toEqual(['stream_chunk', 'stream_end', 'step_start']);
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

    it('pushes only the status, never the whole AgentState', async () => {
      // Nothing on the other end reads this event's data, while the raw state
      // carries the LLM context and every enabled tool's manifest.
      await notifier.publishAgentRuntimeInit('op-1', {
        agentConfig: { systemRole: 'secret prompt' },
        messages: [{ content: 'x'.repeat(50_000), role: 'user' }],
        status: 'running',
        toolManifestMap: { big: 'manifest' },
        userId: 'user-1',
      });

      await new Promise((r) => setTimeout(r, 50));

      const push = mockFetch.mock.calls.find((c: any[]) =>
        String(c[0]).endsWith('/api/operations/push-event'),
      );
      const pushed = JSON.parse(push![1].body);
      const initEvent = (pushed.events ?? [pushed.event ?? pushed]).find(
        (e: any) => e?.type === 'agent_runtime_init' || e?.event?.type === 'agent_runtime_init',
      );
      const data = (initEvent?.data ?? initEvent?.event?.data) as Record<string, unknown>;

      expect(data).toEqual({ status: 'running' });
    });

    it('calls gateway init and push-event endpoints', async () => {
      await notifier.publishAgentRuntimeInit('op-1', { userId: 'user-1' });

      await new Promise((r) => setTimeout(r, 50));

      const urls = mockFetch.mock.calls.map((c: any[]) => c[0]);
      expect(urls).toContain(`${gatewayUrl}/api/operations/init`);
      expect(urls).toContain(`${gatewayUrl}/api/operations/push-event`);
    });

    // Protocol v2 §3.2: the per-user hub describes an op in its lifecycle feed
    // from the `meta` persisted at init, so the routing fields the caller
    // already knows must ride along — and nothing else (no lookups, no
    // agentConfig / modelRuntimeConfig leakage into the gateway).
    it('sends only the known op-routing fields as `meta` in the init body', async () => {
      await notifier.publishAgentRuntimeInit('op-1', {
        agentConfig: { systemRole: 'secret' },
        agentId: 'agt_1',
        groupId: 'grp_1',
        mirrorToOperationId: 'op-supervisor',
        modelRuntimeConfig: { model: 'gpt' },
        parentOperationId: 'op-parent',
        rootOperationId: 'op-root',
        scope: 'group',
        taskId: 'task_1',
        threadId: 'thr_1',
        topicId: 'tpc_1',
        userId: 'user-1',
        workspaceId: 'ws_1',
      });

      const initCall = mockFetch.mock.calls.find(
        (call: any[]) => call[0] === `${gatewayUrl}/api/operations/init`,
      )!;
      expect(JSON.parse(initCall[1].body)).toEqual({
        meta: {
          agentId: 'agt_1',
          groupId: 'grp_1',
          mirrorToOperationId: 'op-supervisor',
          parentOperationId: 'op-parent',
          rootOperationId: 'op-root',
          scope: 'group',
          taskId: 'task_1',
          threadId: 'thr_1',
          topicId: 'tpc_1',
        },
        operationId: 'op-1',
        userId: 'user-1',
      });
    });

    it('omits absent meta keys, and the whole `meta` when nothing applies', async () => {
      // Hetero dispatch shape: only agentId / topicId / (optional) mirror known.
      await notifier.publishAgentRuntimeInit('op-hetero', {
        agentId: 'agt_1',
        mirrorToOperationId: undefined,
        topicId: 'tpc_1',
        userId: 'user-1',
      });
      // Legacy / minimal init (what the coordinator's Redis metadata yields
      // for a plain single-agent run).
      await notifier.publishAgentRuntimeInit('op-legacy', { userId: 'user-1' });

      const bodies = mockFetch.mock.calls
        .filter((call: any[]) => call[0] === `${gatewayUrl}/api/operations/init`)
        .map((call: any[]) => JSON.parse(call[1].body));

      expect(bodies).toEqual([
        {
          meta: { agentId: 'agt_1', topicId: 'tpc_1' },
          operationId: 'op-hetero',
          userId: 'user-1',
        },
        { operationId: 'op-legacy', userId: 'user-1' },
      ]);
      expect(bodies[1]).not.toHaveProperty('meta');
    });

    it('tells the gateway a run is heterogeneous so its watchdog allows long silence', async () => {
      await notifier.publishAgentRuntimeInit('op-cc', {
        agentId: 'agt_1',
        assistantMessageId: 'msg_1',
        heteroType: 'claude-code',
        topicId: 'tpc_1',
        userId: 'user-1',
      });

      const initCall = mockFetch.mock.calls.find(
        (call: any[]) => call[0] === `${gatewayUrl}/api/operations/init`,
      )!;
      expect(JSON.parse(initCall[1].body)).toEqual({
        meta: { agentId: 'agt_1', heteroType: 'claude-code', topicId: 'tpc_1' },
        operationId: 'op-cc',
        userId: 'user-1',
      });
    });

    it('registers the visitor as gateway owner while still sending meta', async () => {
      await notifier.publishAgentRuntimeInit('op-share', {
        streamOwnerUserId: 'visitor-1',
        topicId: 'tpc_1',
        userId: 'creator-1',
      });

      const initCall = mockFetch.mock.calls.find(
        (call: any[]) => call[0] === `${gatewayUrl}/api/operations/init`,
      )!;
      expect(JSON.parse(initCall[1].body)).toEqual({
        meta: { topicId: 'tpc_1' },
        operationId: 'op-share',
        userId: 'visitor-1',
      });
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

    it('sends only terminal metadata after a protocol-v2 message patch', async () => {
      await notifier.publishAgentRuntimeEnd({
        finalState: { messages: ['large'], status: 'done', world: { private: true } },
        messagePatchMode: true,
        messageRevision: 5,
        operationId: 'op-1',
        reason: 'completed',
        stepIndex: 4,
      });
      await new Promise((r) => setTimeout(r, 50));

      const pushCall = mockFetch.mock.calls.find((c: any[]) => c[0].includes('push-event'));
      const body = JSON.parse(pushCall![1].body);
      expect(body.event.data).toMatchObject({
        messagePatchMode: true,
        messageRevision: 5,
        reason: 'completed',
      });
      expect(body.event.data).not.toHaveProperty('finalState');
      expect(body.event.data).not.toHaveProperty('uiMessages');
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
