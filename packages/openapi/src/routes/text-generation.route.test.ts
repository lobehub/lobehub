// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `POST /api/v1/text/generations` and `POST /api/v1/objects/generations` over
 * real HTTP: the real routes behind the `app.ts` auth and workspace
 * middlewares, real permission/scope gates and controller, on PGlite with real
 * `api_keys` rows. Only `AiGenerationService` (the paid model call) is faked.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({
  calls: [] as { ctor: unknown[]; input: any; kind: 'object' | 'text'; options: any }[],
  object: undefined as undefined | ((input: any) => Promise<unknown>),
  serverDB: undefined as unknown,
  text: undefined as undefined | ((input: any) => Promise<unknown>),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));
vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: class {
    ctor: unknown[];
    constructor(...args: unknown[]) {
      this.ctor = args.slice(1);
    }
    async generateText(input: any, options: any) {
      holder.calls.push({ ctor: this.ctor, input, kind: 'text', options });
      return holder.text
        ? holder.text(input)
        : { finishReason: 'stop', text: 'ok', usage: { totalTokens: 3 } };
    }
    async generateObject(input: any, options: any) {
      holder.calls.push({ ctor: this.ctor, input, kind: 'object', options });
      return holder.object ? holder.object(input) : { name: 'Peg hook' };
    }
  },
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, users, workspaceMembers, workspaces } = await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { StructuredOutputError } = await import('@lobechat/model-runtime');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { ObjectGenerationSchema, TextGenerationSchema } =
  await import('../types/text-generation.type');
const TextRoutes = (await import('./text.route')).default;
const ObjectRoutes = (await import('./objects.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const app = new Hono().basePath('/api/v1');
app.onError((error, c) =>
  error instanceof HTTPException
    ? renderApiError(c, errorInitFromException(error))
    : renderApiError(c, { message: error.message, status: 500 }),
);
app.use('*', userAuthMiddleware);
app.use('*', workspaceAuthMiddleware);
app.route('/text', TextRoutes);
app.route('/objects', ObjectRoutes);

const OWNER = 'r6-text-owner';
const STRANGER = 'r6-text-stranger';
const WORKSPACE = 'r6-text-ws';

const KEYS = {
  modelInvoke: 'sk-lh-r6textmodelinvk1',
  read: 'sk-lh-r6textgenread001',
  workspace: 'sk-lh-r6textworkspace1',
  write: 'sk-lh-r6textgenwrite01',
} as const;

const SCHEMA = {
  additionalProperties: false,
  properties: { name: { type: 'string' } },
  required: ['name'],
  type: 'object',
};

const post = (
  path: 'objects' | 'text',
  body: unknown,
  init: { key?: string; workspaceId?: string } = {},
) =>
  app.request(`/api/v1/${path}/generations`, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      ...(init.workspaceId ? { 'x-workspace-id': init.workspaceId } : {}),
    },
    method: 'POST',
  });

const json = async (res: Response) => (await res.json()) as any;

beforeEach(async () => {
  holder.calls.length = 0;
  holder.object = undefined;
  holder.text = undefined;
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: WORKSPACE, name: 'R6 text', primaryOwnerId: OWNER, slug: 'r6-text' }]);
  await serverDB
    .insert(workspaceMembers)
    .values([{ role: 'owner', userId: OWNER, workspaceId: WORKSPACE }]);
  const key = (value: string, scopes: string[], workspaceId?: string) => ({
    key: value,
    keyHash: hashApiKey(value),
    name: value,
    scopes,
    userId: OWNER,
    workspaceId: workspaceId ?? null,
  });
  await serverDB
    .insert(apiKeys)
    .values([
      key(KEYS.write, ['generation:write']),
      key(KEYS.read, ['generation:read']),
      key(KEYS.modelInvoke, ['model:invoke']),
      key(KEYS.workspace, ['generation:write'], WORKSPACE),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    for (const path of ['text', 'objects'] as const) {
      const res = await post(path, { prompt: 'hi', schema: SCHEMA });
      expect(res.status).toBe(401);
      expect((await json(res)).code).toBe('unauthorized');
    }
  });

  it('refuses a read-only key', async () => {
    for (const path of ['text', 'objects'] as const) {
      const res = await post(path, { prompt: 'hi', schema: SCHEMA }, { key: KEYS.read });
      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('insufficient_scope');
    }
    expect(holder.calls).toEqual([]);
  });

  it('accepts generation:write and the legacy model:invoke scope', async () => {
    for (const key of [KEYS.write, KEYS.modelInvoke]) {
      expect((await post('text', { prompt: 'hi' }, { key })).status).toBe(200);
      expect((await post('objects', { prompt: 'hi', schema: SCHEMA }, { key })).status).toBe(200);
    }
  });

  it('runs a workspace key inside its workspace', async () => {
    const res = await post('text', { prompt: 'hi' }, { key: KEYS.workspace });

    expect(res.status).toBe(200);
    expect(holder.calls[0].ctor).toEqual([OWNER, WORKSPACE]);
  });
});

describe('request validation', () => {
  it('needs a prompt or messages and rejects unknown fields', async () => {
    const cases = [
      {},
      { messages: [] },
      { prompt: '' },
      { prompt: 'hi', temperature: 3 },
      { prompt: 'hi', unknown: true },
      { messages: [{ content: 'hi', role: 'tool' }] },
    ];
    for (const body of cases) {
      const res = await post('text', body, { key: KEYS.write });
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
    expect(holder.calls).toEqual([]);
  });

  it('needs an object schema and rejects root keywords the runtime would drop', async () => {
    const cases = [
      { prompt: 'hi' },
      { prompt: 'hi', schema: { properties: {}, type: 'array' } },
      { prompt: 'hi', schema: { ...SCHEMA, allOf: [] } },
      { prompt: 'hi', schema: SCHEMA, schemaName: 'has space' },
    ];
    for (const body of cases) {
      const res = await post('objects', body, { key: KEYS.write });
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
    expect(holder.calls).toEqual([]);
  });

  it('needs a provider when a model is named', async () => {
    const res = await post('text', { model: 'gpt-5.4-mini', prompt: 'hi' }, { key: KEYS.write });

    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('validation_error');
  });
});

describe('text generation', () => {
  it('builds the messages, attributes spend to the API and keeps reasoning out of text', async () => {
    holder.text = async () => ({
      finishReason: 'stop',
      reasoning: 'The user wants one word.',
      text: 'Pegboard',
      usage: {
        outputReasoningTokens: 6,
        totalInputTokens: 12,
        totalOutputTokens: 9,
        totalTokens: 21,
      },
    });

    const res = await post(
      'text',
      {
        maxTokens: 50,
        messages: [{ content: 'Earlier question', role: 'user' }],
        model: 'deepseek-flash',
        prompt: 'One word?',
        provider: 'lobehub',
        system: 'Be brief.',
        temperature: 0,
      },
      { key: KEYS.write },
    );
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(TextGenerationSchema.parse(body.data)).toEqual({
      finishReason: 'stop',
      model: 'deepseek-flash',
      provider: 'lobehub',
      reasoning: 'The user wants one word.',
      text: 'Pegboard',
      usage: { inputTokens: 12, outputTokens: 9, reasoningTokens: 6, totalTokens: 21 },
    });
    expect(holder.calls[0].input).toEqual({
      maxTokens: 50,
      messages: [
        { content: 'Be brief.', role: 'system' },
        { content: 'Earlier question', role: 'user' },
        { content: 'One word?', role: 'user' },
      ],
      model: 'deepseek-flash',
      provider: 'lobehub',
      temperature: 0,
    });
    expect(holder.calls[0].options.metadata.trigger).toBe('api');
  });

  it('maps provider failures to 502 and budget refusals to their own status', async () => {
    holder.text = async () => {
      throw { error: { message: 'upstream exploded' }, errorType: 'ProviderBizError' };
    };
    const upstream = await post('text', { prompt: 'hi' }, { key: KEYS.write });
    expect(upstream.status).toBe(502);
    expect(await json(upstream)).toMatchObject({ code: 'upstream_error' });
    expect((await post('text', { prompt: 'hi' }, { key: KEYS.write })).status).toBe(502);

    holder.text = async () => {
      throw { errorType: 429 };
    };
    const limited = await post('text', { prompt: 'hi' }, { key: KEYS.write });
    expect(limited.status).toBe(429);
    expect((await json(limited)).code).toBe('rate_limited');
  });
});

describe('object generation', () => {
  it('passes the schema through and answers { object }', async () => {
    const res = await post(
      'objects',
      {
        model: 'deepseek-flash',
        prompt: 'A pegboard hook',
        provider: 'lobehub',
        schema: SCHEMA,
        schemaDescription: 'One concept',
        schemaName: 'concept',
        strict: true,
      },
      { key: KEYS.write },
    );
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(ObjectGenerationSchema.parse(body.data)).toEqual({
      model: 'deepseek-flash',
      object: { name: 'Peg hook' },
      provider: 'lobehub',
    });
    expect(holder.calls[0].input).toMatchObject({
      messages: [{ content: 'A pegboard hook', role: 'user' }],
      schema: { description: 'One concept', name: 'concept', schema: SCHEMA, strict: true },
    });
  });

  it('answers 422 when the reply is not an object for the schema', async () => {
    for (const reply of [
      async () => {
        throw new StructuredOutputError('not json');
      },
      async () => undefined,
      async () => ['a list'],
    ]) {
      holder.object = reply;
      const res = await post('objects', { prompt: 'hi', schema: SCHEMA }, { key: KEYS.write });
      expect(res.status).toBe(422);
      expect((await json(res)).code).toBe('unprocessable_entity');
    }
  });
});
