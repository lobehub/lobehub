import { describe, expect, it, vi } from 'vitest';

import {
  buildSteerPrompt,
  type HeteroSteerClient,
  type HeteroSteerMessage,
  withHeteroSteer,
} from './heteroSteer';

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

const createClient = (messages: Array<HeteroSteerMessage | null>) => {
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
    expect(wait.mock.calls[0][0]).toEqual({ acceptsImages: true, blockMs: 1, operationId: 'op-1' });
    expect(wait.mock.calls[1][0]).toEqual({ acceptsImages: true, operationId: 'op-1' });
    expect(await out).toEqual([
      { data: { liveSteer: true, newStep: true }, type: 'stream_start' },
      replay('msg-1'),
    ]);
  });

  it('holds follow-ups while the session waits for the user, and gives back one handed out then', async () => {
    const { client, giveBack, wait } = createClient([{ content: 'go', messageId: 'msg-1' }]);
    const sendUserMessage = vi.fn(async () => true);
    const stream = createStream();

    const out = collect(
      withHeteroSteer(
        { events: stream.events, sendUserMessage },
        { getTrpcClient: async () => client, isWaitingForUser: () => true, operationId: 'op-1' },
      ),
    );
    await vi.waitFor(() => expect(giveBack).toHaveBeenCalled());
    stream.end();
    await out;

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(giveBack).toHaveBeenCalledWith({ messageId: 'msg-1', operationId: 'op-1' });
    expect(wait.mock.calls[0][0]).toMatchObject({ holdSteer: true });
  });

  it('types images pasted into a follow-up in as image blocks', async () => {
    const image = { id: 'file_1', url: 'https://bucket.example.com/1.png?sig=s' };
    const { client } = createClient([
      {
        content: '![image.png](https://app.lobehub.com/f/file_1)',
        imageList: [image],
        messageId: 'msg-1',
      },
    ]);
    const sendUserMessage = vi.fn(async () => true);
    const stream = createStream();

    const out = collect(
      withHeteroSteer(
        { events: stream.events, sendUserMessage },
        { getTrpcClient: async () => client, operationId: 'op-1' },
      ),
    );
    await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalled());
    stream.end();
    await out;

    expect(sendUserMessage).toHaveBeenCalledWith(
      [
        { text: '![image.png](https://app.lobehub.com/f/file_1)', type: 'text' },
        { source: { id: 'file_1', type: 'url', url: image.url }, type: 'image' },
      ],
      { uuid: 'msg-1' },
    );
  });

  it('falls back to the text when its images cannot be loaded', async () => {
    const { client, giveBack } = createClient([
      {
        content: 'see this',
        imageList: [{ id: 'f', url: 'https://x/expired' }],
        messageId: 'msg-1',
      },
    ]);
    const sendUserMessage = vi.fn(async (prompt: unknown) => {
      if (typeof prompt !== 'string') throw new Error('image fetch failed: 403');
      return true;
    });
    const stream = createStream();

    const out = collect(
      withHeteroSteer(
        { events: stream.events, sendUserMessage },
        { getTrpcClient: async () => client, operationId: 'op-1' },
      ),
    );
    await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledTimes(2));
    stream.end();
    await out;

    expect(sendUserMessage).toHaveBeenLastCalledWith('see this', { uuid: 'msg-1' });
    expect(giveBack).not.toHaveBeenCalled();
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

describe('buildSteerPrompt', () => {
  it('keeps a text-only follow-up a plain string', () => {
    expect(buildSteerPrompt({ content: 'hi', messageId: 'm' })).toBe('hi');
    expect(buildSteerPrompt({ content: 'hi', imageList: [], messageId: 'm' })).toBe('hi');
  });
});
