// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Import after mocks — and import the handler file directly (not via the
// agent-hono barrel) so we don't trigger Hono module resolution. The handler
// only imports Hono types, which are erased at runtime.
import { toolResult } from '../toolResult';

const mockPipelineExec = vi.fn().mockResolvedValue([]);
const mockExpire = vi.fn(() => ({ exec: mockPipelineExec }));
const mockLpush = vi.fn(() => ({ expire: mockExpire }));
const mockPipeline = vi.fn(() => ({ lpush: mockLpush }));
const mockRedisClient = { pipeline: mockPipeline } as any;

let currentRedisClient: any = mockRedisClient;
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => currentRedisClient,
}));

/**
 * Minimal Hono Context stub matching only the surface `toolResult` reaches.
 * We hand-build this because vitest's module resolver can't load the `hono`
 * package in this repo (pnpm-isolated, not hoisted), so a real Hono Context
 * would require fixing repo-level resolution. Testing the handler with a
 * stub keeps coverage on the redis + zod paths, which is where the value is.
 */
function buildContext(body: unknown) {
  let captured: { status: number; body: any } | undefined;
  const ctx = {
    body: (b: any, status: number) => {
      captured = { body: b, status };
      return new Response(b, { status });
    },
    json: (b: any, status = 200) => {
      captured = { body: b, status };
      return Response.json(b, { status });
    },
    req: {
      json: async () => body,
    },
  } as any;
  return { ctx, getCaptured: () => captured };
}

const validBody = {
  content: '{"ok":true}',
  success: true,
  toolCallId: 'call-abc',
};

describe('toolResult handler', () => {
  beforeEach(() => {
    currentRedisClient = mockRedisClient;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when body is invalid', async () => {
    const { ctx, getCaptured } = buildContext({ toolCallId: 'x' });
    const res = await toolResult(ctx);
    expect(res.status).toBe(400);
    expect(getCaptured()?.body).toMatchObject({ error: 'Invalid body' });
  });

  it('returns 400 when JSON parse throws', async () => {
    const ctx = {
      json: (b: any, status: number) => Response.json(b, { status }),
      req: {
        json: async () => {
          throw new Error('bad json');
        },
      },
    } as any;
    const res = await toolResult(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 503 when Redis is unavailable', async () => {
    currentRedisClient = null;
    const { ctx } = buildContext(validBody);
    const res = await toolResult(ctx);
    expect(res.status).toBe(503);
  });

  it('LPUSHes the payload and sets TTL on happy path', async () => {
    const { ctx } = buildContext(validBody);
    const res = await toolResult(ctx);
    expect(res.status).toBe(204);
    expect(mockLpush).toHaveBeenCalledWith(
      'tool_result:call-abc',
      expect.stringContaining('"toolCallId":"call-abc"'),
    );
    expect(mockExpire).toHaveBeenCalledWith('tool_result:call-abc', 120);
    expect(mockPipelineExec).toHaveBeenCalled();
  });

  it('returns 503 when Redis pipeline exec throws', async () => {
    mockPipelineExec.mockRejectedValueOnce(new Error('redis down'));
    const { ctx } = buildContext(validBody);
    const res = await toolResult(ctx);
    expect(res.status).toBe(503);
  });
});
