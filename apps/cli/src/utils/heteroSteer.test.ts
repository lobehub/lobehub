import { describe, expect, it, vi } from 'vitest';

import { type HeteroSteerClient, withHeteroSteer } from './heteroSteer';

vi.mock('./logger', () => ({ log: { debug: vi.fn() } }));

type Event = { data?: any; type: string };

/** An event stream the test pushes into, ended with `end()`. */
const createStream = () => {
  const queue: Event[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  const events: AsyncIterable<Event> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        if (ended) return;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
  return {
    end: () => {
      ended = true;
      wake?.();
    },
    events,
    push: (event: Event) => {
      queue.push(event);
      wake?.();
    },
  };
};

const collect = async (iterable: AsyncIterable<Event>) => {
  const out: Event[] = [];
  for await (const event of iterable) out.push(event);
  return out;
};

const replay = (uuid: string): Event => ({
  data: { phase: 'user_message', uuid },
  type: 'step_complete',
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const createClient = (messages: Array<{ content: string; messageId: string } | null>) => {
  const wait = vi.fn(async (_input: unknown, options?: { signal?: AbortSignal }) => {
    const next = messages.shift();
    if (next !== undefined) return { message: next };
    // Hold like the long-poll until the loop is stopped.
    await new Promise((_resolve, reject) =>
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
    );
    return { message: null };
  });
  const giveBack = vi.fn(async () => ({ success: true }));
  const client: HeteroSteerClient = {
    aiAgent: { returnHeteroSteer: { mutate: giveBack }, waitHeteroSteer: { mutate: wait } },
  };
  return { client, giveBack, wait };
};

describe('withHeteroSteer', () => {
  it('types a queued follow-up into the session and forwards only its replay', async () => {
    const { client, wait } = createClient([null, { content: 'use pnpm', messageId: 'msg-1' }]);
    const sendUserMessage = vi.fn(async () => true);
    const stream = createStream();

    const out = collect(
      withHeteroSteer(
        { events: stream.events, sendUserMessage },
        { getTrpcClient: async () => client, operationId: 'op-1' },
      ),
    );
    await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalled());
    stream.push(replay('uuid-prompt'));
    stream.push({ data: { newStep: true }, type: 'stream_start' });
    stream.push(replay('msg-1'));
    stream.end();

    expect(sendUserMessage).toHaveBeenCalledWith('use pnpm', { uuid: 'msg-1' });
    expect(wait.mock.calls[0][0]).toEqual({ blockMs: 1, operationId: 'op-1' });
    expect(await out).toEqual([
      { data: { liveSteer: true, newStep: true }, type: 'stream_start' },
      replay('msg-1'),
    ]);
  });

  it('gives a refused message back and stops polling', async () => {
    const { client, giveBack, wait } = createClient([{ content: 'hi', messageId: 'msg-1' }]);
    const stream = createStream();

    const out = collect(
      withHeteroSteer(
        { events: stream.events, sendUserMessage: async () => false },
        { getTrpcClient: async () => client, operationId: 'op-1' },
      ),
    );
    await vi.waitFor(() => expect(giveBack).toHaveBeenCalled());
    await flush();
    stream.end();
    await out;

    expect(giveBack).toHaveBeenCalledWith({ messageId: 'msg-1', operationId: 'op-1' });
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('stops asking a server that does not know the procedure, and never marks the run', async () => {
    const wait = vi.fn(async () => {
      throw Object.assign(new Error('No procedure'), { data: { code: 'NOT_FOUND' } });
    });
    const client = {
      aiAgent: { returnHeteroSteer: { mutate: vi.fn() }, waitHeteroSteer: { mutate: wait } },
    } as unknown as HeteroSteerClient;
    const stream = createStream();

    const out = collect(
      withHeteroSteer(
        { events: stream.events, sendUserMessage: async () => true },
        { getTrpcClient: async () => client, operationId: 'op-1' },
      ),
    );
    await vi.waitFor(() => expect(wait).toHaveBeenCalled());
    stream.push({ data: {}, type: 'stream_start' });
    stream.end();

    expect(await out).toEqual([{ data: {}, type: 'stream_start' }]);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('stops polling, and never marks the run, when the server says it is not steerable', async () => {
    const wait = vi.fn(async () => ({ message: null, steerable: false as const }));
    const client = {
      aiAgent: { returnHeteroSteer: { mutate: vi.fn() }, waitHeteroSteer: { mutate: wait } },
    } as unknown as HeteroSteerClient;
    const stream = createStream();

    const out = collect(
      withHeteroSteer(
        { events: stream.events, sendUserMessage: async () => true },
        { getTrpcClient: async () => client, operationId: 'op-child' },
      ),
    );
    await vi.waitFor(() => expect(wait).toHaveBeenCalled());
    await flush();
    stream.push({ data: {}, type: 'stream_start' });
    stream.end();

    expect(await out).toEqual([{ data: {}, type: 'stream_start' }]);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('passes events through without a server or a live session', async () => {
    const stream = createStream();
    stream.push(replay('uuid-prompt'));
    stream.end();

    expect(await collect(withHeteroSteer({ events: stream.events }, false))).toEqual([
      replay('uuid-prompt'),
    ]);
  });
});
