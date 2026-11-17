// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/sandboxes` over real HTTP: the real routes, scope gates,
 * controller, REST service and the shared `sandboxStorage` procedures, on
 * PGlite with real API keys, environments and instances. Faked are only the
 * far side of the network — the drive's storage endpoint and the sandbox
 * session — plus the plan check that grants a drive.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({
  callTool: vi.fn(),
  createSandboxService: vi.fn(),
  serverDB: undefined as unknown,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

// every account in this test is entitled to a drive
vi.mock('@/business/server/sandboxStorage', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveSandboxStorageEntitlement: async () => ({ quotaBytes: 1_000_000_000 }),
}));

vi.mock('@/server/services/sandbox/factory', () => ({
  createSandboxService: holder.createSandboxService,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, environmentInstances, environments, users } = await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { MarketService } = await import('@/server/services/market');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const {
  SandboxCommandResultSchema,
  SandboxFileContentSchema,
  SandboxFileListSchema,
  SandboxListResponseSchema,
  SandboxSchema,
} = await import('../types/sandbox.type');
const SandboxRoutes = (await import('./sandboxes.route')).default;

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
app.route('/sandboxes', SandboxRoutes);

const OWNER = 'r13-sandbox-owner';
const STRANGER = 'r13-sandbox-stranger';
const ENV_OWNER = '11111111-1111-4111-8111-111111111111';
const ENV_STRANGER = '22222222-2222-4222-8222-222222222222';

const KEYS = {
  full: 'sk-lh-r13sbxfullacc001',
  operate: 'sk-lh-r13sbxoperate001',
  read: 'sk-lh-r13sbxread000001',
  stranger: 'sk-lh-r13sbxstranger01',
} as const;

const storage = {
  listFiles: vi.fn(),
  listInstances: vi.fn(),
  readFile: vi.fn(),
  readOccupancy: vi.fn(),
  writeFile: vi.fn(),
};
vi.spyOn(MarketService.prototype, 'getSandboxStorageClient').mockReturnValue(storage as any);

const auditLog = vi.spyOn(console, 'info');
const auditLines = () =>
  auditLog.mock.calls
    .filter(([tag]) => tag === '[openapi:audit]')
    .map(([, line]) => JSON.parse(line as string));

const call = (path: string, init: { body?: unknown; key?: string; method?: string } = {}) =>
  app.request(`/api/v1${path}`, {
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      'content-type': 'application/json',
    },
    method: init.method ?? 'GET',
  });

const json = async (res: Response) => (await res.json()) as any;

const createSandbox = async (key: string = KEYS.operate, environmentId = ENV_OWNER) => {
  const res = await call('/sandboxes', {
    body: { environmentId, name: 'Atlas', workingDirectory: 'atlas' },
    key,
    method: 'POST',
  });
  expect(res.status).toBe(201);
  return SandboxSchema.parse((await json(res)).data);
};

beforeEach(async () => {
  await serverDB.delete(environmentInstances);
  await serverDB.delete(environments);
  await serverDB.delete(apiKeys);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB.insert(environments).values([
    { configuration: {}, id: ENV_OWNER, name: 'Atlas', userId: OWNER },
    { configuration: {}, id: ENV_STRANGER, name: 'Secret', userId: STRANGER },
  ]);

  const key = (value: string, userId: string, scopes: string[]) => ({
    key: value,
    keyHash: hashApiKey(value),
    name: value,
    scopes,
    userId,
  });
  await serverDB
    .insert(apiKeys)
    .values([
      key(KEYS.read, OWNER, ['device:read']),
      key(KEYS.operate, OWNER, ['device:read', 'device:operate']),
      key(KEYS.full, OWNER, ['*']),
      key(KEYS.stranger, STRANGER, ['device:read', 'device:operate']),
    ]);

  for (const spy of Object.values(storage)) spy.mockReset();
  // an empty drive: every folder is free
  storage.listFiles.mockResolvedValue({ entries: [], path: '', truncated: false });
  storage.listInstances.mockResolvedValue({ instances: [] });
  storage.readOccupancy.mockResolvedValue({ held: [] });
  holder.callTool.mockReset();
  holder.createSandboxService.mockReset();
  holder.createSandboxService.mockReturnValue({ callTool: holder.callTool });
  auditLog.mockClear();
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    expect((await call('/sandboxes')).status).toBe(401);
  });

  it('refuses create, file writes and commands without device:operate — full access included', async () => {
    const sandbox = await createSandbox();

    for (const key of [KEYS.read, KEYS.full]) {
      for (const [path, method, body] of [
        ['/sandboxes', 'POST', { environmentId: ENV_OWNER }],
        [`/sandboxes/${sandbox.id}/files/content`, 'PUT', { content: 'x', path: 'a.txt' }],
        [`/sandboxes/${sandbox.id}/commands`, 'POST', { command: 'ls' }],
      ] as const) {
        const res = await call(path, { body, key, method });
        expect(res.status, `${key} ${method} ${path}`).toBe(403);
        expect((await json(res)).code).toBe('insufficient_scope');
      }
    }
    expect(storage.writeFile).not.toHaveBeenCalled();
    expect(holder.callTool).not.toHaveBeenCalled();
  });
});

describe('sandboxes', () => {
  it('creates a sandbox from the caller’s environment, audits it, and lists it', async () => {
    const sandbox = await createSandbox();

    expect(sandbox).toMatchObject({
      drive: 'personal',
      environmentId: ENV_OWNER,
      name: 'Atlas',
      // an environment with nothing to clone or install is ready as created
      status: 'ready',
      workingDirectory: 'atlas',
    });
    expect(auditLines()).toEqual([
      expect.objectContaining({
        action: 'sandbox.created',
        metadata: expect.objectContaining({ environmentId: ENV_OWNER, success: true }),
        resourceId: sandbox.id,
        resourceType: 'sandbox',
        userId: OWNER,
      }),
    ]);

    const list = await call('/sandboxes', { key: KEYS.read });
    expect(list.status).toBe(200);
    const page = SandboxListResponseSchema.parse((await json(list)).data);
    expect(page.items.map((item) => item.id)).toEqual([sandbox.id]);
    expect(page.total).toBe(1);

    const one = await call(`/sandboxes/${sandbox.id}`, { key: KEYS.read });
    expect(SandboxSchema.parse((await json(one)).data).id).toBe(sandbox.id);
  });

  it('refuses another user’s environment and hides another user’s sandbox', async () => {
    const res = await call('/sandboxes', {
      body: { environmentId: ENV_STRANGER },
      key: KEYS.operate,
      method: 'POST',
    });
    expect(res.status).toBe(404);

    const theirs = await createSandbox(KEYS.stranger, ENV_STRANGER);
    for (const [path, method, body] of [
      [`/sandboxes/${theirs.id}`, 'GET', undefined],
      [`/sandboxes/${theirs.id}/files`, 'GET', undefined],
      [`/sandboxes/${theirs.id}/files/content?path=a.txt`, 'GET', undefined],
      [`/sandboxes/${theirs.id}/files/content`, 'PUT', { content: 'x', path: 'a.txt' }],
      [`/sandboxes/${theirs.id}/commands`, 'POST', { command: 'cat .env' }],
    ] as const) {
      const response = await call(path, { body, key: KEYS.operate, method });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect((await json(await call('/sandboxes', { key: KEYS.read }))).data.items).toEqual([]);
    expect(holder.callTool).not.toHaveBeenCalled();
  });

  it('validates ids, paths and bodies', async () => {
    const sandbox = await createSandbox();

    for (const [path, method, body] of [
      ['/sandboxes/not-a-uuid', 'GET', undefined],
      [`/sandboxes/${sandbox.id}/files?path=../other`, 'GET', undefined],
      [`/sandboxes/${sandbox.id}/files/content?path=/etc/passwd`, 'GET', undefined],
      [`/sandboxes/${sandbox.id}/files/content`, 'PUT', { content: 'x', path: '../escape' }],
      [`/sandboxes/${sandbox.id}/commands`, 'POST', { command: '' }],
      ['/sandboxes', 'POST', { environmentId: ENV_OWNER, workingDirectory: 'a/b' }],
    ] as const) {
      const res = await call(path, { body, key: KEYS.operate, method });
      expect(res.status, `${method} ${path}`).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
  });
});

describe('files', () => {
  it('lists and reads inside the sandbox directory', async () => {
    const sandbox = await createSandbox();
    storage.listFiles.mockResolvedValue({
      entries: [{ isDirectory: false, name: 'README.md', path: 'atlas/README.md', size: 6 }],
      path: 'atlas',
      truncated: false,
    });
    storage.readFile.mockResolvedValue({
      content: '# Atlas',
      mimeType: 'text/markdown',
      path: 'atlas/README.md',
    });

    const list = await call(`/sandboxes/${sandbox.id}/files`, { key: KEYS.read });
    expect(list.status).toBe(200);
    expect(SandboxFileListSchema.parse((await json(list)).data).entries).toEqual([
      { isDirectory: false, modifiedAt: null, name: 'README.md', path: 'README.md', size: 6 },
    ]);
    expect(storage.listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'atlas' }));

    const file = await call(`/sandboxes/${sandbox.id}/files/content?path=README.md`, {
      key: KEYS.read,
    });
    expect(file.status).toBe(200);
    expect(SandboxFileContentSchema.parse((await json(file)).data)).toEqual({
      content: '# Atlas',
      mimeType: 'text/markdown',
      path: 'README.md',
    });
    expect(storage.readFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'atlas/README.md' }),
    );
  });

  it('writes a file with device:operate and audits it', async () => {
    const sandbox = await createSandbox();
    auditLog.mockClear();
    storage.writeFile.mockResolvedValue({ path: 'atlas/src/a.ts' });

    const res = await call(`/sandboxes/${sandbox.id}/files/content`, {
      body: { content: 'export {}', path: 'src/a.ts' },
      key: KEYS.operate,
      method: 'PUT',
    });

    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ path: 'src/a.ts', written: true });
    expect(storage.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'export {}', path: 'atlas/src/a.ts' }),
    );
    expect(auditLines()).toEqual([
      expect.objectContaining({
        action: 'sandbox.file_written',
        metadata: expect.objectContaining({ bytes: 9, path: 'src/a.ts', success: true }),
        resourceId: sandbox.id,
      }),
    ]);
  });
});

describe('commands', () => {
  it('runs a command in the sandbox directory and audits it', async () => {
    const sandbox = await createSandbox();
    auditLog.mockClear();
    holder.callTool.mockResolvedValue({
      result: { exitCode: 0, stdout: 'atlas\n' },
      success: true,
    });

    const res = await call(`/sandboxes/${sandbox.id}/commands`, {
      body: { command: 'pwd', timeoutMs: 5000 },
      key: KEYS.operate,
      method: 'POST',
    });
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(SandboxCommandResultSchema.parse(body.data)).toEqual({
      exitCode: 0,
      output: 'atlas\n',
      stderr: null,
      success: true,
    });
    // the instance's own directory and snapshot, on the session agent runs use
    expect(holder.createSandboxService).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxCwd: 'atlas',
        sandboxInstanceId: sandbox.id,
        sandboxMode: 'persistent',
        topicId: `openapi-sandbox:${sandbox.id}`,
        userId: OWNER,
      }),
    );
    expect(holder.callTool).toHaveBeenCalledWith(
      'runCommand',
      expect.objectContaining({ command: 'pwd', timeout: 5000 }),
    );
    expect(auditLines()).toEqual([
      expect.objectContaining({
        action: 'sandbox.command_executed',
        metadata: expect.objectContaining({ command: 'pwd', phase: 'dispatched' }),
        resourceId: sandbox.id,
      }),
      expect.objectContaining({
        action: 'sandbox.command_executed',
        metadata: expect.objectContaining({
          command: 'pwd',
          exitCode: 0,
          phase: 'completed',
          success: true,
        }),
        resourceId: sandbox.id,
        resourceType: 'sandbox',
      }),
    ]);
  });
});
