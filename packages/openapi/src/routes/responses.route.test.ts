import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  openResponsesErrors,
  OpenResponsesHttpErrorSchema,
} from '../middleware/open-responses-errors';
import { requestIdMiddleware } from '../middleware/request-id';
import { ResponseObjectSchema } from '../types/responses.type';

const { assertRunAuthorizedMock, createResponseMock, createStreamingResponseMock } = vi.hoisted(
  () => ({
    assertRunAuthorizedMock: vi.fn(),
    createResponseMock: vi.fn(),
    createStreamingResponseMock: vi.fn(),
  }),
);

// The route and the real controller run; only the db, auth and the responses
// service behind the controller are stubbed.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => next(),
}));
vi.mock('../services/responses.service', () => ({
  ResponsesService: class {
    assertRunAuthorized = assertRunAuthorizedMock;
    createResponse = createResponseMock;
    createStreamingResponse = createStreamingResponseMock;
  },
}));

const { default: ResponsesRoutes } = await import('./responses.route');

const responseObject = {
  background: false,
  completed_at: 1_700_000_001,
  created_at: 1_700_000_000,
  error: null,
  frequency_penalty: 0,
  id: 'tpc_1',
  incomplete_details: null,
  instructions: null,
  max_output_tokens: null,
  max_tool_calls: null,
  metadata: {},
  model: 'agt_1',
  object: 'response',
  output: [
    {
      content: [{ annotations: [], logprobs: [], text: 'Hi', type: 'output_text' }],
      id: 'msg_tpc_1_0',
      role: 'assistant',
      status: 'completed',
      type: 'message',
    },
  ],
  output_text: 'Hi',
  parallel_tool_calls: true,
  presence_penalty: 0,
  previous_response_id: null,
  prompt_cache_key: null,
  reasoning: null,
  safety_identifier: null,
  service_tier: 'default',
  status: 'completed',
  store: true,
  temperature: 1,
  text: { format: { type: 'text' } },
  tool_choice: 'auto',
  tools: [],
  top_logprobs: 0,
  top_p: 1,
  truncation: 'disabled',
  usage: {
    input_tokens: 1,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 1,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 2,
  },
  user: null,
};

describe('POST /responses', () => {
  it('answers with the bare response object, not the success envelope', async () => {
    createResponseMock.mockResolvedValue(responseObject);
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userId' as never, 'user-1' as never);
      c.set('authType' as never, 'oidc' as never);
      await next();
    });
    app.route('/', ResponsesRoutes);

    const res = await app.request('/', {
      body: JSON.stringify({ input: 'hi', model: 'agt_1' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty('success');
    expect(() => ResponseObjectSchema.parse(body)).not.toThrow();
  });

  const errorApp = () => {
    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('*', openResponsesErrors);
    app.use('*', async (c, next) => {
      c.set('userId' as never, 'user-1' as never);
      c.set('authType' as never, 'oidc' as never);
      await next();
    });
    app.route('/', ResponsesRoutes);
    return app;
  };

  it('answers a validation failure in the OpenResponses error shape with a requestId', async () => {
    const res = await errorApp().request('/', {
      body: JSON.stringify({ input: 'hi' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(OpenResponsesHttpErrorSchema.parse(body)).toMatchObject({
      error: { code: 'validation_error', type: 'invalid_request_error' },
    });
    expect(body.requestId).toBe(res.headers.get('X-Request-Id'));
    expect(body).not.toHaveProperty('success');
  });

  // Regression for the responses RBAC gap: a denied streaming request opened
  // SSE first, answering 200 before any guard ran.
  it('denies a stream request before SSE opens, answering the error over HTTP', async () => {
    assertRunAuthorizedMock.mockRejectedValue(
      Object.assign(new Error('no use'), { code: 'FORBIDDEN', name: 'TRPCError' }),
    );

    const res = await errorApp().request('/', {
      body: JSON.stringify({ input: 'hi', model: 'agt_1', stream: true }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).not.toContain('text/event-stream');
    expect(await res.json()).toMatchObject({
      error: { code: 'forbidden', type: 'invalid_request_error' },
      requestId: res.headers.get('X-Request-Id'),
    });
    expect(createStreamingResponseMock).not.toHaveBeenCalled();
  });

  it('answers a thrown service error in the OpenResponses error shape', async () => {
    createResponseMock.mockRejectedValue(
      Object.assign(new Error('agent not found'), { code: 'NOT_FOUND', name: 'TRPCError' }),
    );
    const res = await errorApp().request('/', {
      body: JSON.stringify({ input: 'hi', model: 'agt_missing' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: 'not_found', message: 'agent not found', param: null, type: 'not_found' },
      requestId: res.headers.get('X-Request-Id'),
    });
  });
});
