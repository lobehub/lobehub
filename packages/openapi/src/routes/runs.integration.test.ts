// @vitest-environment node
/**
 * End-to-end over the REST surface: `POST /runs` starts a real agent run (the
 * same `AiAgentService` / runtime the app uses, with in-memory state and
 * stream managers and a stubbed LLM), then the run is followed and steered
 * only through `/runs/*`.
 */
import { Hono } from 'hono';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { agents, users } from '@/database/schemas';
import { ToolExecutionService } from '@/server/services/toolExecution';

process.env.OPENAI_API_KEY = 'sk-test-fake-api-key-for-testing';

const db = await getTestDB();

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => db }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));
vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => next(),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return { getFullFileUrl: vi.fn(async (path: string) => (path ? `/files${path}` : null)) };
  }),
}));

const { default: RunRoutes } = await import('./runs.route');
const { RunEventSchema, RunSchema } = await import('../types/run.type');

const USER = 'runs-integration-user';
const STRANGER = 'runs-integration-stranger';
const FINAL_ANSWER = 'It is sunny in Hangzhou, 15-22°C.';
const TIMEOUT = 30_000;

const request = (
  path: string,
  init: { as?: string; body?: unknown; headers?: Record<string, string>; method?: string } = {},
) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, (init.as ?? USER) as never);
    await next();
  });
  app.route('/', RunRoutes);
  return app.request(path, {
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    method: init.method ?? 'GET',
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
};

const json = async (res: Response) => ((await res.json()) as { data: any }).data;

/** Parse an SSE body into `{ event, id, data }` messages. */
const readEvents = async (res: Response) =>
  (await res.text())
    .split('\n\n')
    .filter((block) => block.trim() && !block.startsWith(':'))
    .map((block) => {
      const fields = Object.fromEntries(
        block.split('\n').map((line) => {
          const colon = line.indexOf(':');
          return [line.slice(0, colon), line.slice(colon + 1).trimStart()];
        }),
      );
      return { data: JSON.parse(fields.data), event: fields.event, id: fields.id };
    });

/** Poll `GET /runs/{id}` until the run leaves `queued` / `running`. */
const waitForStop = async (id: string) => {
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    const run = await json(await request(`/${id}`));
    if (!['queued', 'running'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Run ${id} did not stop within ${TIMEOUT}ms`);
};

const responsesStream = (chunks: unknown[]) => {
  const iterator = () => ({
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
    toReadableStream: () =>
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
  });
  return Object.assign(iterator(), { tee: () => [iterator(), iterator()] });
};

const created = (id: string) => ({
  response: {
    created_at: 0,
    id,
    model: 'gpt-5-pro',
    object: 'response',
    output: [],
    status: 'in_progress',
  },
  type: 'response.created',
});

/** First model turn: say something, then call web search. */
const searchTurn = () => {
  const call = {
    arguments: JSON.stringify({ query: 'Hangzhou weather' }),
    call_id: 'call_search_1',
    name: 'lobe-web-browsing____search',
    type: 'function_call',
  };
  const text = 'Let me look that up.';
  return responsesStream([
    created('resp_1'),
    {
      item: { content: [], id: 'msg_1', role: 'assistant', status: 'in_progress', type: 'message' },
      output_index: 0,
      type: 'response.output_item.added',
    },
    {
      content_index: 0,
      delta: text,
      item_id: 'msg_1',
      output_index: 0,
      type: 'response.output_text.delta',
    },
    { item: call, output_index: 1, type: 'response.output_item.added' },
    {
      response: {
        created_at: 0,
        id: 'resp_1',
        model: 'gpt-5-pro',
        object: 'response',
        output: [
          {
            content: [{ text, type: 'output_text' }],
            id: 'msg_1',
            role: 'assistant',
            status: 'completed',
            type: 'message',
          },
          call,
        ],
        status: 'completed',
        usage: { input_tokens: 50, output_tokens: 20, total_tokens: 70 },
      },
      type: 'response.completed',
    },
  ]);
};

/** Second model turn: the answer. */
const answerTurn = () =>
  responsesStream([
    created('resp_2'),
    {
      content_index: 0,
      delta: FINAL_ANSWER,
      item_id: 'msg_2',
      output_index: 0,
      type: 'response.output_text.delta',
    },
    {
      response: {
        created_at: 0,
        id: 'resp_2',
        model: 'gpt-5-pro',
        object: 'response',
        output: [
          {
            content: [{ text: FINAL_ANSWER, type: 'output_text' }],
            id: 'msg_2',
            role: 'assistant',
            status: 'completed',
            type: 'message',
          },
        ],
        status: 'completed',
        usage: { input_tokens: 90, output_tokens: 15, total_tokens: 105 },
      },
      type: 'response.completed',
    },
  ]);

let agentId: string;
let executeTool: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([{ id: USER }, { id: STRANGER }]);
  const [agent] = await db
    .insert(agents)
    .values({
      chatConfig: { searchMode: 'auto' },
      model: 'gpt-5-pro',
      plugins: [],
      provider: 'openai',
      systemRole: 'You answer weather questions.',
      title: 'Weather',
      userId: USER,
    })
    .returning();
  agentId = agent.id;

  let turn = 0;
  vi.spyOn(OpenAI.Responses.prototype, 'create').mockImplementation(
    () => Promise.resolve((++turn === 1 ? searchTurn() : answerTurn()) as any) as any,
  );
  executeTool = vi.spyOn(ToolExecutionService.prototype, 'executeTool').mockResolvedValue({
    content: 'Hangzhou: sunny, 15-22°C',
    error: null,
    executionTime: 5,
    state: {},
    success: true,
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Start a run whose every tool call asks for approval, and wait for it to park. */
const startParkedRun = async () => {
  const res = await request('/', {
    body: {
      agentId,
      allowList: [],
      approvalMode: 'allow-list',
      input: 'How is the weather in Hangzhou?',
    },
    method: 'POST',
  });
  expect(res.status).toBe(202);
  const { id, status, topicId } = await json(res);
  expect(status).toBe('queued');
  expect(topicId).toBeTruthy();

  const parked = await waitForStop(id);
  expect(parked.status).toBe('waiting_for_human');
  return { id, parked };
};

describe('runs: start → events → approval → completion', () => {
  it(
    'follows the run through its event stream, approves the tool call and completes',
    async () => {
      const { id, parked } = await startParkedRun();

      expect(() => RunSchema.parse(parked)).not.toThrow();
      expect(parked.pendingInterventionCount).toBe(1);
      expect(executeTool).not.toHaveBeenCalled();

      // The run's stream replays what happened and closes on the park.
      const events = await readEvents(await request(`/${id}/events`));
      for (const { data } of events) expect(() => RunEventSchema.parse(data)).not.toThrow();
      const types = events.map(({ event }) => event);
      expect(types[0]).toBe('run.started');
      expect(types).toContain('message.delta');
      expect(types).toContain('message.completed');
      expect(types.slice(-2)).toEqual(['intervention.requested', 'run.waiting']);
      expect(events[0].id).toMatch(/^\d+-\d+$/);
      const requested = events.at(-2)!.data.data.interventions;
      expect(requested).toEqual([
        expect.objectContaining({
          id: 'call_search_1',
          tool: expect.objectContaining({ apiName: 'search', identifier: 'lobe-web-browsing' }),
          type: 'approval',
        }),
      ]);

      // Resuming after the first event skips it.
      const resumed = await readEvents(
        await request(`/${id}/events`, { headers: { 'Last-Event-ID': events[0].id } }),
      );
      expect(resumed[0].event).not.toBe('run.started');
      expect(resumed.at(-1)!.event).toBe('run.waiting');

      const { items } = await json(await request(`/${id}/interventions`));
      expect(items.map((item: any) => item.id)).toEqual(['call_search_1']);

      // An answer does not fit an approval.
      const misfit = await request(`/${id}/interventions/call_search_1`, {
        body: { action: 'answer', content: 'yes' },
        method: 'POST',
      });
      expect(misfit.status).toBe(400);

      const approved = await request(`/${id}/interventions/call_search_1`, {
        body: { action: 'approve' },
        method: 'POST',
      });
      expect(approved.status).toBe(200);
      const { continuedByRunId } = await json(approved);
      expect(continuedByRunId).toBeTruthy();
      expect(continuedByRunId).not.toBe(id);

      const finished = await waitForStop(continuedByRunId);
      expect(finished.status).toBe('completed');
      expect(finished.result.content).toBe(FINAL_ANSWER);
      expect(executeTool).toHaveBeenCalledWith(
        expect.objectContaining({ apiName: 'search', identifier: 'lobe-web-browsing' }),
        expect.anything(),
      );

      expect((await json(await request(`/${id}`))).continuedByRunId).toBe(continuedByRunId);

      const tail = await readEvents(await request(`/${continuedByRunId}/events`));
      const tailTypes = tail.map(({ event }) => event);
      expect(tailTypes).toContain('tool_call.completed');
      expect(tailTypes.at(-1)).toBe('run.completed');
      expect(tail.at(-1)!.data.data.result.content).toBe(FINAL_ANSWER);

      // The intervention is gone once resolved.
      const again = await request(`/${id}/interventions/call_search_1`, {
        body: { action: 'approve' },
        method: 'POST',
      });
      expect(again.status).toBe(404);
    },
    TIMEOUT * 2,
  );
});

describe('runs: cancel', () => {
  it(
    'cancels a parked run without running the tool',
    async () => {
      const { id } = await startParkedRun();

      const res = await request(`/${id}/cancel`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ cancelled: true, id, status: 'cancelled' });

      const run = await json(await request(`/${id}`));
      expect(run.status).toBe('cancelled');
      expect(run.pendingInterventionCount).toBe(0);
      expect(executeTool).not.toHaveBeenCalled();

      const events = await readEvents(await request(`/${id}/events`));
      expect(events.at(-1)!.event).toBe('run.cancelled');

      // Cancelling again is a no-op.
      expect(await json(await request(`/${id}/cancel`, { method: 'POST' }))).toEqual({
        cancelled: false,
        id,
        status: 'cancelled',
      });
    },
    TIMEOUT * 2,
  );
});

describe('runs: ownership', () => {
  it(
    'hides a run from another user, on every sub-resource',
    async () => {
      const { id } = await startParkedRun();

      for (const [path, method] of [
        [`/${id}`, 'GET'],
        [`/${id}/events`, 'GET'],
        [`/${id}/interventions`, 'GET'],
        [`/${id}/cancel`, 'POST'],
      ] as const) {
        const res = await request(path, { as: STRANGER, method });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
      const resolve = await request(`/${id}/interventions/call_search_1`, {
        as: STRANGER,
        body: { action: 'approve' },
        method: 'POST',
      });
      expect(resolve.status).toBe(404);
      expect((await json(await request(`/${id}`))).status).toBe('waiting_for_human');
    },
    TIMEOUT * 2,
  );
});
