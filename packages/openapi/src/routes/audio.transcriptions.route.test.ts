// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `POST /api/v1/audio/transcriptions` over real HTTP: the real route behind the
 * `app.ts` auth and workspace middlewares, real permission/scope gates and
 * controller, on PGlite with real `api_keys` rows. Only the shared
 * `asr.transcribe` procedure (the paid provider call) is faked.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({
  calls: [] as { ctx: any; input: any }[],
  serverDB: undefined as unknown,
  transcribe: undefined as undefined | ((input: any) => Promise<{ text: string }>),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));
vi.mock('@/server/routers/lambda/asr', () => ({
  asrRouter: {
    createCaller: (ctx: any) => ({
      transcribe: async (input: any) => {
        holder.calls.push({ ctx, input });
        return holder.transcribe ? holder.transcribe(input) : { text: 'hello world' };
      },
    }),
  },
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, users, workspaceMembers, workspaces } = await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { TRPCError } = await import('@trpc/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { MAX_TRANSCRIPTION_UPLOAD_BYTES, TranscriptionSchema } =
  await import('../types/generation.type');
const AudioRoutes = (await import('./audio.route')).default;

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
app.route('/audio', AudioRoutes);

const OWNER = 'r6-asr-owner';
const STRANGER = 'r6-asr-stranger';
const WORKSPACE = 'r6-asr-ws';
const OTHER_WORKSPACE = 'r6-asr-other-ws';

const KEYS = {
  fileReader: 'sk-lh-r6asrfilereader1',
  modelInvoke: 'sk-lh-r6asrmodelinvok1',
  read: 'sk-lh-r6asrgenread0001',
  workspace: 'sk-lh-r6asrworkspace01',
  write: 'sk-lh-r6asrgenwrite001',
} as const;

const clip = (bytes = 16, type = 'audio/mpeg') =>
  new File([new Uint8Array(bytes).fill(1)], 'clip.mp3', { type });

const transcribe = (
  fields: Record<string, string | File>,
  init: { key?: string; workspaceId?: string } = {},
) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return app.request('/api/v1/audio/transcriptions', {
    body: form,
    headers: {
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      ...(init.workspaceId ? { 'x-workspace-id': init.workspaceId } : {}),
    },
    method: 'POST',
  });
};

const json = async (res: Response) => (await res.json()) as any;

beforeEach(async () => {
  holder.calls.length = 0;
  holder.transcribe = undefined;
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB.insert(workspaces).values([
    { id: WORKSPACE, name: 'R6 asr', primaryOwnerId: OWNER, slug: 'r6-asr' },
    { id: OTHER_WORKSPACE, name: 'R6 other', primaryOwnerId: STRANGER, slug: 'r6-asr-other' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'owner', userId: STRANGER, workspaceId: OTHER_WORKSPACE },
  ]);
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
      key(KEYS.fileReader, ['generation:write', 'file:read']),
      key(KEYS.workspace, ['generation:write'], WORKSPACE),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    const res = await transcribe({ file: clip(), model: 'whisper-1' });

    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe('unauthorized');
  });

  it('needs generation:write, not just read or the legacy model:invoke', async () => {
    for (const key of [KEYS.read, KEYS.modelInvoke]) {
      const res = await transcribe({ file: clip(), model: 'whisper-1' }, { key });

      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('insufficient_scope');
    }
    expect(holder.calls).toEqual([]);
  });

  it('needs file:read as well to transcribe a stored file', async () => {
    const refused = await transcribe({ fileId: 'file_1', model: 'whisper-1' }, { key: KEYS.write });
    expect(refused.status).toBe(403);
    expect((await json(refused)).code).toBe('insufficient_scope');

    const allowed = await transcribe(
      { fileId: 'file_1', model: 'whisper-1' },
      { key: KEYS.fileReader },
    );
    expect(allowed.status).toBe(200);
    expect(holder.calls[0].input).toMatchObject({ fileId: 'file_1', model: 'whisper-1' });
  });
});

describe('request validation', () => {
  it('rejects missing or conflicting audio and bad fields', async () => {
    const cases: Record<string, string | File>[] = [
      { model: 'whisper-1' },
      { file: clip(), fileId: 'file_1', model: 'whisper-1' },
      { file: clip() },
      { file: clip(), model: 'whisper-1', response_format: 'mp3' },
      { file: clip(), model: 'whisper-1', unknown: 'x' },
      { file: clip(0), model: 'whisper-1' },
    ];

    for (const fields of cases) {
      const res = await transcribe(fields, { key: KEYS.write });
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
    expect(holder.calls).toEqual([]);
  });

  it('answers 413 for a clip over the inline limit', async () => {
    const res = await transcribe(
      { file: clip(MAX_TRANSCRIPTION_UPLOAD_BYTES + 1), model: 'whisper-1' },
      { key: KEYS.write },
    );

    expect(res.status).toBe(413);
    expect((await json(res)).code).toBe('payload_too_large');
  });
});

describe('transcription', () => {
  it('hands the clip to the shared procedure and answers { text }', async () => {
    const res = await transcribe(
      {
        file: clip(32, 'audio/mp4'),
        language: 'en',
        model: 'whisper-1',
        prompt: 'plants',
        provider: 'openai',
      },
      { key: KEYS.write },
    );

    expect(res.status).toBe(200);
    expect(TranscriptionSchema.parse(await json(res))).toEqual({ text: 'hello world' });
    expect(holder.calls).toEqual([
      {
        ctx: { userId: OWNER, workspaceId: undefined },
        input: {
          audioBase64: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
          fileName: 'clip.mp3',
          language: 'en',
          mimeType: 'audio/mp4',
          model: 'whisper-1',
          prompt: 'plants',
          provider: 'openai',
          responseFormat: undefined,
        },
      },
    ]);
  });

  it("maps the procedure's refusals to HTTP errors", async () => {
    holder.transcribe = async () => {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
    };

    const res = await transcribe(
      { fileId: 'file_other', model: 'whisper-1' },
      {
        key: KEYS.fileReader,
      },
    );
    expect(res.status).toBe(404);
    expect((await json(res)).message).toBe('File not found');
  });
});

describe('provider failures', () => {
  it('answers 502 with the provider reason instead of an empty 500', async () => {
    holder.transcribe = async () => {
      throw new TRPCError({
        cause: {
          error: { message: 'Incorrect API key provided' },
          errorType: 'InvalidProviderAPIKey',
        } as unknown as Error,
        code: 'INTERNAL_SERVER_ERROR',
      });
    };

    const res = await transcribe({ file: clip(), model: 'whisper-1' }, { key: KEYS.write });

    expect(res.status).toBe(502);
    expect(await json(res)).toMatchObject({
      code: 'upstream_error',
      message: 'Transcription provider error (InvalidProviderAPIKey): Incorrect API key provided',
    });
  });
});

describe('workspace isolation', () => {
  it('transcribes inside the key workspace and refuses another workspace', async () => {
    const ok = await transcribe({ file: clip(), model: 'whisper-1' }, { key: KEYS.workspace });
    expect(ok.status).toBe(200);
    expect(holder.calls[0].ctx).toEqual({ userId: OWNER, workspaceId: WORKSPACE });

    const other = await transcribe(
      { file: clip(), model: 'whisper-1' },
      { key: KEYS.workspace, workspaceId: OTHER_WORKSPACE },
    );
    expect(other.status).toBe(403);
    expect((await json(other)).code).toBe('workspace_mismatch');
  });
});
