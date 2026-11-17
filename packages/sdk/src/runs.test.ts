import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Run, RunEvent } from './index';
import { createLobeHub } from './index';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

const envelope = (data: unknown) => ({ data, success: true, timestamp: '2026-01-01T00:00:00Z' });

const event = (type: RunEvent['type'], id: string | null, data: unknown = {}) => ({
  data,
  id,
  runId: 'op-1',
  stepIndex: 0,
  timestamp: 1,
  type,
});

const sse = (events: ReturnType<typeof event>[]) =>
  new Response(
    events
      .map(
        (item) =>
          `${item.id ? `id: ${item.id}\n` : ''}event: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`,
      )
      .join(': ping\n\n'),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );

const RUN: Run = {
  agentId: 'agt-1',
  completedAt: null,
  completionReason: null,
  continuedByRunId: null,
  cost: { currency: 'USD', total: null },
  createdAt: '2026-01-01T00:00:00Z',
  error: null,
  groupId: null,
  id: 'op-1',
  maxSteps: null,
  model: null,
  parentRunId: null,
  pendingInterventionCount: 0,
  pendingToolCalls: [],
  provider: null,
  result: null,
  startedAt: null,
  status: 'running',
  stepCount: 0,
  taskId: null,
  threadId: null,
  topicId: 'tpc-1',
  trigger: null,
  usage: { inputTokens: 0, llmCalls: 0, outputTokens: 0, toolCalls: 0, totalTokens: 0 },
};

const mockFetch = (handler: (request: Request, index: number) => Response | Promise<Response>) => {
  const requests: Request[] = [];
  const fetch = (async (input: Request) => {
    requests.push(input);
    return handler(input, requests.length - 1);
  }) as typeof globalThis.fetch;
  return { fetch, requests };
};

describe('runs.stream', () => {
  it('yields typed events and resolves finalEvent() with the closing one', async () => {
    const { fetch, requests } = mockFetch(() =>
      sse([
        event('run.started', '1-0'),
        event('message.delta', '2-0', { delta: 'Hi' }),
        event('run.completed', null, { result: { content: 'Hi', messageId: 'm' } }),
      ]),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const stream = lobehub.runs.stream('op-1');
    let text = '';
    for await (const item of stream) {
      expectTypeOf(item).toEqualTypeOf<RunEvent>();
      if (item.type === 'message.delta') text += item.data.delta;
    }

    expect(text).toBe('Hi');
    expect(stream.lastEventId).toBe('2-0');
    expect(await stream.finalEvent()).toMatchObject({ type: 'run.completed' });
    expect(new URL(requests[0].url).pathname).toBe('/api/v1/runs/op-1/events');
    expect(requests[0].headers.get('Last-Event-ID')).toBeNull();
  });

  it('reconnects with Last-Event-ID when the server closes before a closing event', async () => {
    const { fetch, requests } = mockFetch((_request, index) =>
      index === 0
        ? sse([event('run.started', '1-0'), event('step.started', '2-0', { llmCalls: 0 })])
        : sse([event('run.waiting', '3-0', { status: 'waiting_for_human' })]),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const types: string[] = [];
    for await (const item of lobehub.runs.stream('op-1')) types.push(item.type);

    expect(types).toEqual(['run.started', 'step.started', 'run.waiting']);
    expect(requests).toHaveLength(2);
    expect(requests[1].headers.get('Last-Event-ID')).toBe('2-0');
  });

  it('starts from `after`, and can be told not to reconnect', async () => {
    const { fetch, requests } = mockFetch(() =>
      sse([event('step.started', '5-0', { llmCalls: 1 })]),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const types: string[] = [];
    for await (const item of lobehub.runs.stream('op-1', { after: '4-0', reconnect: false }))
      types.push(item.type);

    expect(types).toEqual(['step.started']);
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get('Last-Event-ID')).toBe('4-0');
  });

  it('gives up when reconnects keep bringing nothing', async () => {
    const { fetch } = mockFetch(() => sse([]));
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    await expect(lobehub.runs.stream('op-1').finalEvent()).rejects.toThrow(/without new events/);
  });
});

describe('runs.createAndStream', () => {
  it('starts the run, then streams it', async () => {
    const { fetch, requests } = mockFetch((request) =>
      request.method === 'POST'
        ? json(
            envelope({
              id: 'op-1',
              scheduledAt: null,
              status: 'queued',
              topicId: 'tpc-1',
              userMessageId: 'msg-1',
            }),
            { status: 202 },
          )
        : sse([event('run.completed', null, { result: null })]),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const stream = await lobehub.runs.createAndStream({ agentId: 'agt-1', input: 'hi' });

    expect(stream.run.id).toBe('op-1');
    expect(stream.runId).toBe('op-1');
    expect((await stream.finalEvent()).type).toBe('run.completed');
    expect(await requests[0].json()).toEqual({ agentId: 'agt-1', input: 'hi' });
    expect(new URL(requests[1].url).pathname).toBe('/api/v1/runs/op-1/events');
  });
});

describe('runs.wait', () => {
  it('polls until the run settles, following the run that continues it', async () => {
    const states = [
      { ...RUN, status: 'running' },
      { ...RUN, continuedByRunId: 'op-2', status: 'waiting_for_human' },
      { ...RUN, id: 'op-2', status: 'running' },
      { ...RUN, id: 'op-2', result: { content: 'Done', messageId: 'm' }, status: 'completed' },
    ];
    const { fetch, requests } = mockFetch((_request, index) => json(envelope(states[index])));
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const run = await lobehub.runs.wait('op-1', { pollInterval: 1 });

    expect(run).toMatchObject({ id: 'op-2', status: 'completed' });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/v1/runs/op-1',
      '/api/v1/runs/op-1',
      '/api/v1/runs/op-2',
      '/api/v1/runs/op-2',
    ]);
  });

  it('returns a run that waits on you', async () => {
    const { fetch } = mockFetch(() =>
      json(envelope({ ...RUN, pendingInterventionCount: 1, status: 'waiting_for_human' })),
    );
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    expect((await lobehub.runs.wait('op-1', { pollInterval: 1 })).status).toBe('waiting_for_human');
  });

  it('rejects after the timeout', async () => {
    const { fetch } = mockFetch(() => json(envelope(RUN)));
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    await expect(lobehub.runs.wait('op-1', { pollInterval: 5, timeout: 20 })).rejects.toThrow(
      /still running/,
    );
  });
});
