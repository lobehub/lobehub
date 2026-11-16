import { PassThrough } from 'node:stream';

import { ClaudeCodeLiveInput } from '@lobechat/heterogeneous-agents/spawn';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  dispatchHeteroControl,
  type HeteroControlMessage,
  registerHeteroControlHandler,
} from './heteroControl';
import { type HeteroSteerClient, withHeteroSteer } from './heteroSteer';

vi.mock('./logger', () => ({ log: { debug: vi.fn() } }));

type Event = { data?: any; type: string };

/** An event stream the test ends with `end()`. */
const createStream = () => {
  let wake: (() => void) | undefined;
  let ended = false;
  const events: AsyncIterable<Event> = {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<Event>> => {
        while (!ended) await new Promise<void>((resolve) => (wake = resolve));
        return { done: true, value: undefined };
      },
    }),
  };
  return {
    end: () => {
      ended = true;
      wake?.();
    },
    events,
  };
};

const control = (command: string, params: unknown = null): HeteroControlMessage => ({
  command,
  createdAt: 1,
  id: `ctl-${command}`,
  params,
});

type Answer = Awaited<ReturnType<HeteroSteerClient['aiAgent']['waitHeteroSteer']['mutate']>>;

/** A client whose polls answer `answers` in turn, then hold until aborted. */
const createClient = (answers: Answer[]) => {
  const wait = vi.fn(async (_input: unknown, options?: { signal?: AbortSignal }) => {
    const next = answers.shift();
    if (next) return next;
    await new Promise((_resolve, reject) =>
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
    );
    return { message: null };
  });
  const reportResult = vi.fn(async () => ({ outcome: 'recorded' }));
  const client: HeteroSteerClient = {
    aiAgent: {
      reportHeteroControlResult: { mutate: reportResult },
      returnHeteroSteer: { mutate: vi.fn() },
      waitHeteroSteer: { mutate: wait },
    },
  };
  return { client, reportResult, wait };
};

/** A live Claude Code stdin the test reads back. */
const createLiveInput = () => {
  const stdin = new PassThrough();
  const written: any[] = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const raw of chunk.toString().split('\n')) if (raw) written.push(JSON.parse(raw));
  });
  return { live: new ClaudeCodeLiveInput(stdin), written };
};

const run = async (answers: Answer[], handle: Partial<Parameters<typeof withHeteroSteer>[0]>) => {
  const { client, reportResult, wait } = createClient(answers);
  const stream = createStream();
  const out = (async () => {
    for await (const _ of withHeteroSteer(
      { events: stream.events, sendUserMessage: async () => true, ...handle },
      { getTrpcClient: async () => client, operationId: 'op-1' },
    ));
  })();
  return { end: async () => (stream.end(), out), reportResult, wait };
};

const unregister: Array<() => void> = [];
afterEach(() => {
  while (unregister.length > 0) unregister.pop()!();
});

describe('dispatchHeteroControl', () => {
  it('reports an unknown command as unsupported', async () => {
    expect(
      await dispatchHeteroControl(control('test_unknown'), {
        operationId: 'op-1',
        sendControlRequest: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).toEqual({ status: 'unsupported' });
  });

  it('reports what the handler returns, and a throw as an error', async () => {
    unregister.push(
      registerHeteroControlHandler('test_ok', ({ params }) => ({ echoed: params })),
      registerHeteroControlHandler('test_void', () => {}),
      registerHeteroControlHandler('test_throw', async () => {
        throw new Error('handler failed');
      }),
    );
    const context = {
      operationId: 'op-1',
      sendControlRequest: vi.fn(),
      signal: new AbortController().signal,
    };

    expect(await dispatchHeteroControl(control('test_ok', { a: 1 }), context)).toEqual({
      data: { echoed: { a: 1 } },
      status: 'ok',
    });
    expect(await dispatchHeteroControl(control('test_void'), context)).toEqual({ status: 'ok' });
    expect(await dispatchHeteroControl(control('test_throw'), context)).toEqual({
      error: 'handler failed',
      status: 'error',
    });
  });

  it('removes a handler again', async () => {
    const remove = registerHeteroControlHandler('test_once', () => 1);
    remove();
    expect(
      await dispatchHeteroControl(control('test_once'), {
        operationId: 'op-1',
        sendControlRequest: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).toEqual({ status: 'unsupported' });
  });
});

describe('withHeteroSteer control messages', () => {
  it('declares acceptsControl when the session takes control requests', async () => {
    const { live } = createLiveInput();
    const { end, wait } = await run([], {
      sendControlRequest: (request) => live.sendControlRequest(request),
    });
    await vi.waitFor(() => expect(wait).toHaveBeenCalled());
    await end();

    expect(wait.mock.calls[0][0]).toEqual({
      acceptsControl: true,
      acceptsImages: true,
      blockMs: 1,
      operationId: 'op-1',
    });
  });

  it('does not declare it without a way to write control requests', async () => {
    const { end, wait } = await run([], {});
    await vi.waitFor(() => expect(wait).toHaveBeenCalled());
    await end();

    expect(wait.mock.calls[0][0]).not.toHaveProperty('acceptsControl');
  });

  it('runs the handler, which writes into the session stdin, and reports ok', async () => {
    const { live, written } = createLiveInput();
    unregister.push(
      registerHeteroControlHandler('test_stop', async ({ params, sendControlRequest }) => {
        const sent = sendControlRequest({ subtype: 'stop_task', task_id: (params as any).taskId });
        if (!sent) throw new Error('input closed');
        const answer = await sent.response;
        if (answer.subtype === 'error') throw new Error(answer.error);
        return answer.response;
      }),
    );

    const { end, reportResult } = await run(
      [{ control: control('test_stop', { taskId: 't-1' }), message: null }],
      { sendControlRequest: (request) => live.sendControlRequest(request) },
    );
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toEqual({
      request: { subtype: 'stop_task', task_id: 't-1' },
      request_id: expect.any(String),
      type: 'control_request',
    });
    live.observe(
      `${JSON.stringify({
        response: { request_id: written[0].request_id, response: { ok: 1 }, subtype: 'success' },
        type: 'control_response',
      })}\n`,
    );
    await vi.waitFor(() => expect(reportResult).toHaveBeenCalled());
    await end();

    expect(reportResult).toHaveBeenCalledWith({
      controlId: 'ctl-test_stop',
      data: { ok: 1 },
      operationId: 'op-1',
      status: 'ok',
    });
  });

  it('reports an unknown command as unsupported and a failing handler as an error', async () => {
    const { live } = createLiveInput();
    unregister.push(
      registerHeteroControlHandler('test_throw', () => {
        throw new Error('handler failed');
      }),
    );

    const { end, reportResult } = await run(
      [
        { control: control('test_unknown'), message: null },
        { control: control('test_throw'), message: null },
      ],
      { sendControlRequest: (request) => live.sendControlRequest(request) },
    );
    await vi.waitFor(() => expect(reportResult).toHaveBeenCalledTimes(2));
    await end();

    expect(reportResult).toHaveBeenCalledWith({
      controlId: 'ctl-test_unknown',
      operationId: 'op-1',
      status: 'unsupported',
    });
    expect(reportResult).toHaveBeenCalledWith({
      controlId: 'ctl-test_throw',
      error: 'handler failed',
      operationId: 'op-1',
      status: 'error',
    });
  });

  it('keeps polling a child run for control messages when the server delivers them', async () => {
    const { live } = createLiveInput();
    const { end, reportResult, wait } = await run(
      [
        { control: null, message: null, steerable: false },
        { control: control('test_unknown'), message: null, steerable: false },
      ],
      { sendControlRequest: (request) => live.sendControlRequest(request) },
    );
    await vi.waitFor(() => expect(reportResult).toHaveBeenCalled());
    await end();

    expect(wait).toHaveBeenCalledTimes(3);
    // Only the first poll answers at once.
    expect(wait.mock.calls[1][0]).not.toHaveProperty('blockMs');
  });

  it('stops polling a child run on a server that predates control messages', async () => {
    const { live } = createLiveInput();
    const { end, wait } = await run([{ message: null, steerable: false }], {
      sendControlRequest: (request) => live.sendControlRequest(request),
    });
    await vi.waitFor(() => expect(wait).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    await end();

    expect(wait).toHaveBeenCalledTimes(1);
  });
});
