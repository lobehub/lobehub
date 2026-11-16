// @vitest-environment node
import { PassThrough } from 'node:stream';

import { ClaudeCodeLiveInput } from '@lobechat/heterogeneous-agents/spawn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendHeteroControl } from '@/server/services/aiAgent/steerQueue/heteroControl';
import { createHeteroControlFakeRedis } from '@/server/services/redis/heteroControl.fake';

// The producer side, as `lh hetero exec` runs it.
import { registerHeteroControlHandler } from '../../../../../cli/src/utils/heteroControl';
import { type HeteroSteerClient, withHeteroSteer } from '../../../../../cli/src/utils/heteroSteer';
import { heteroRouter } from './hetero';

/**
 * The control channel end to end, without a real Claude Code: the server
 * queues a command, the CLI's steer loop claims it through the real
 * `waitHeteroSteer` procedure, dispatches it to a handler that writes into a
 * live Claude Code stdin, and reports through `reportHeteroControlResult`,
 * where the queuing code reads the result.
 */

const mocks = vi.hoisted(() => ({ getRedisServiceClient: vi.fn() }));

vi.mock('../../../../../cli/src/utils/logger', () => ({ log: { debug: vi.fn() } }));
vi.mock('@/server/services/redis/client', () => ({
  getRedisServiceClient: mocks.getRedisServiceClient,
}));
// No follow-ups in these runs; the control path is what is under test.
vi.mock('@/server/services/aiAgent/steerQueue/hetero', () => ({
  renewHeteroSteers: vi.fn(),
  returnHeteroSteer: vi.fn(),
  takeHeteroSteer: vi.fn(async () => undefined),
}));
vi.mock('./procedures', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  const operation = {
    agentId: 'agent-1',
    parentOperationId: null,
    threadId: null,
    topicId: 'topic-1',
    userId: 'user-1',
    workspaceId: null,
  };
  const serverDB = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [operation] }) }) }),
  };
  const procedure = trpc.procedure.use((opts) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: serverDB as never } }),
  );
  return {
    aiAgentBaseProcedure: procedure,
    aiAgentWriteProcedure: procedure,
    heteroAgentProcedure: procedure,
  };
});

const ctx = { heteroAuthKind: 'user', userId: 'user-1' } as never;
const caller = heteroRouter.createCaller(ctx);

/**
 * A held long-poll the CLI aborts, as fetch over HTTP would: the CLI stops
 * waiting at once, and the request's signal reaches the procedure.
 */
const abortable = <T>(call: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')));
    call(signal).then(resolve, reject);
  });

/** The lambda client `lh hetero exec` uses, answered by the router in-process. */
const client: HeteroSteerClient = {
  aiAgent: {
    reportHeteroControlResult: {
      mutate: (input) => caller.reportHeteroControlResult(input),
    },
    returnHeteroSteer: { mutate: (input) => caller.returnHeteroSteer(input) },
    waitHeteroSteer: {
      // A short hold keeps the test quick; the protocol is the same.
      mutate: (input, options) =>
        abortable(
          (signal) =>
            heteroRouter.createCaller(ctx, { signal }).waitHeteroSteer({ blockMs: 2000, ...input }),
          options?.signal,
        ),
    },
  },
};

/** A Claude Code stdin that answers every control request like the CLI would. */
const createClaudeCode = () => {
  const stdin = new PassThrough();
  const live = new ClaudeCodeLiveInput(stdin);
  const requests: any[] = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const raw of chunk.toString().split('\n')) {
      if (!raw) continue;
      const line = JSON.parse(raw);
      if (line.type !== 'control_request') continue;
      requests.push(line);
      live.observe(
        `${JSON.stringify({
          response: {
            request_id: line.request_id,
            response: { stopped: line.request.task_id },
            subtype: 'success',
          },
          type: 'control_response',
        })}\n`,
      );
    }
  });
  return { live, requests };
};

/** Runs the CLI's steer loop over an event stream that lasts until `end()`. */
const startRun = (handle: Omit<Parameters<typeof withHeteroSteer>[0], 'events'>) => {
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
  const events: AsyncIterable<{ type: string }> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await done;
        return { done: true, value: undefined };
      },
    }),
  };
  const run = (async () => {
    for await (const _ of withHeteroSteer(
      { ...handle, events },
      { getTrpcClient: async () => client, operationId: 'op-1' },
    ));
  })();
  return async () => {
    finish();
    await run;
  };
};

const unregister: Array<() => void> = [];

beforeEach(() => {
  mocks.getRedisServiceClient.mockResolvedValue(createHeteroControlFakeRedis());
});

afterEach(() => {
  while (unregister.length > 0) unregister.pop()!();
});

describe('hetero control channel (server ↔ lh hetero exec)', () => {
  it('delivers a command into the session and returns its result to the server', async () => {
    unregister.push(
      registerHeteroControlHandler('test_stop_task', async ({ params, sendControlRequest }) => {
        const sent = sendControlRequest({
          subtype: 'stop_task',
          task_id: (params as { taskId: string }).taskId,
        });
        if (!sent) throw new Error('The session no longer takes input');
        const answer = await sent.response;
        if (answer.subtype === 'error') throw new Error(answer.error);
        return answer.response;
      }),
    );
    const claudeCode = createClaudeCode();
    const end = startRun({
      sendControlRequest: (request) => claudeCode.live.sendControlRequest(request),
      sendUserMessage: async () => true,
    });

    const { state } = await sendHeteroControl(
      'op-1',
      'test_stop_task',
      { taskId: 't-1' },
      {
        pollMs: 20,
        timeoutMs: 8000,
      },
    );
    await end();

    expect(claudeCode.requests).toEqual([
      {
        request: { subtype: 'stop_task', task_id: 't-1' },
        request_id: expect.any(String),
        type: 'control_request',
      },
    ]);
    expect(state).toEqual({ data: { stopped: 't-1' }, status: 'ok' });
  });

  it('reports a command the CLI has no handler for as unsupported', async () => {
    const claudeCode = createClaudeCode();
    const end = startRun({
      sendControlRequest: (request) => claudeCode.live.sendControlRequest(request),
      sendUserMessage: async () => true,
    });

    const { state } = await sendHeteroControl('op-1', 'test_not_registered', null, {
      pollMs: 20,
      timeoutMs: 8000,
    });
    await end();

    expect(state).toEqual({ status: 'unsupported' });
    expect(claudeCode.requests).toEqual([]);
  });

  it('reports a failing handler as an error', async () => {
    unregister.push(
      registerHeteroControlHandler('test_failing', () => {
        throw new Error('nothing to stop');
      }),
    );
    const claudeCode = createClaudeCode();
    const end = startRun({
      sendControlRequest: (request) => claudeCode.live.sendControlRequest(request),
      sendUserMessage: async () => true,
    });

    const { state } = await sendHeteroControl('op-1', 'test_failing', null, {
      pollMs: 20,
      timeoutMs: 8000,
    });
    await end();

    expect(state).toEqual({ error: 'nothing to stop', status: 'error' });
  });

  it('expires the command for a producer that does not declare acceptsControl', async () => {
    // A producer without control requests polls the way an older `lh` does.
    const end = startRun({ sendUserMessage: async () => true });

    const { state } = await sendHeteroControl('op-1', 'test_stop_task', null, {
      pollMs: 20,
      timeoutMs: 2500,
    });
    await end();

    expect(state).toEqual({ status: 'expired' });
  });
});
