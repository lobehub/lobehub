// @vitest-environment node
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/devices` over real HTTP: the real routes behind the auth and
 * workspace middlewares, the real API-key scope gates, controller, REST
 * service and the shared `device` tRPC procedures, on PGlite. API keys and
 * devices are real rows. The one thing faked is the device gateway — the
 * service that talks to the machines — because there is no machine.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, devices, users, workspaceAuditLogs, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { deviceGateway } = await import('@/server/services/deviceGateway');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const {
  DeviceCommandResultSchema,
  DeviceDetailSchema,
  DeviceFileContentSchema,
  DeviceFileListSchema,
  DeviceGitDiffSchema,
  DeviceGitLogSchema,
  DeviceGitOperationResultSchema,
  DeviceGitStatusSchema,
  DeviceListResponseSchema,
} = await import('../types/device.type');
const DeviceRoutes = (await import('./devices.route')).default;
const ApiKeysRoutes = (await import('./api-keys.route')).default;

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
app.route('/devices', DeviceRoutes);
app.route('/api-keys', ApiKeysRoutes);

const OWNER = 'r13-device-owner';
const MEMBER = 'r13-device-member';
const VIEWER = 'r13-device-viewer';
const STRANGER = 'r13-device-stranger';
const WORKSPACE = 'ws_r13_devices';
const OTHER_WORKSPACE = 'ws_r13_devices_other';

const DEVICE = {
  otherWorkspace: 'dev-r13-other-ws',
  ownerPersonal: 'dev-r13-owner-laptop',
  strangerPersonal: 'dev-r13-stranger-box',
  wsPrivate: 'dev-r13-ws-private',
  wsPublic: 'dev-r13-ws-public',
} as const;

// `sk-lh-` + exactly 16 lowercase alphanumerics, or the format check rejects the key
const KEYS = {
  chatOnly: 'sk-lh-r13devchatonly01',
  full: 'sk-lh-r13devfullacc001',
  fullOperate: 'sk-lh-r13devfullop0001',
  legacy: 'sk-lh-r13devlegacy0001',
  operate: 'sk-lh-r13devoperate001',
  read: 'sk-lh-r13devread000001',
  stranger: 'sk-lh-r13devstranger01',
  wsMember: 'sk-lh-r13devwsmember01',
  wsOwner: 'sk-lh-r13devwsowner001',
  wsViewer: 'sk-lh-r13devwsviewer01',
} as const;

const REPO = '/Users/owner/repo';

const call = (
  path: string,
  init: { body?: unknown; key?: string; method?: string; workspaceId?: string } = {},
) =>
  app.request(`/api/v1${path}`, {
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      ...(init.workspaceId ? { 'x-workspace-id': init.workspaceId } : {}),
      'content-type': 'application/json',
    },
    method: init.method ?? 'GET',
  });

const json = async (res: Response) => (await res.json()) as any;

const gateway = {
  checkoutGitBranch: vi.spyOn(deviceGateway, 'checkoutGitBranch'),
  executeToolCall: vi.spyOn(deviceGateway, 'executeToolCall'),
  getGitBranchDiff: vi.spyOn(deviceGateway, 'getGitBranchDiff'),
  getGitWorkingTreeFiles: vi.spyOn(deviceGateway, 'getGitWorkingTreeFiles'),
  getGitWorkingTreePatches: vi.spyOn(deviceGateway, 'getGitWorkingTreePatches'),
  getLocalFilePreview: vi.spyOn(deviceGateway, 'getLocalFilePreview'),
  gitAheadBehind: vi.spyOn(deviceGateway, 'gitAheadBehind'),
  gitBranch: vi.spyOn(deviceGateway, 'gitBranch'),
  gitWorkingTreeStatus: vi.spyOn(deviceGateway, 'gitWorkingTreeStatus'),
  listProjectDirectory: vi.spyOn(deviceGateway, 'listProjectDirectory'),
  pullGitBranch: vi.spyOn(deviceGateway, 'pullGitBranch'),
  queryDeviceList: vi.spyOn(deviceGateway, 'queryDeviceList'),
  queryDeviceMetrics: vi.spyOn(deviceGateway, 'queryDeviceMetrics'),
  queryDeviceSystemInfo: vi.spyOn(deviceGateway, 'queryDeviceSystemInfo'),
  writeProjectFile: vi.spyOn(deviceGateway, 'writeProjectFile'),
};

const auditLog = vi.spyOn(console, 'info');

const commandState = (stdout: string, exitCode = 0) => ({
  content: stdout,
  state: { exitCode, isBackground: false, output: stdout, running: false, stdout, success: true },
  success: true,
});

beforeEach(async () => {
  await serverDB.delete(workspaceAuditLogs);
  await serverDB.delete(devices);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB
    .insert(users)
    .values([{ id: OWNER }, { id: MEMBER }, { id: VIEWER }, { id: STRANGER }]);
  await serverDB.insert(workspaces).values([
    { id: WORKSPACE, name: 'Team', primaryOwnerId: OWNER, slug: 'r13-team' },
    { id: OTHER_WORKSPACE, name: 'Other', primaryOwnerId: STRANGER, slug: 'r13-other' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'member', userId: MEMBER, workspaceId: WORKSPACE },
    { role: 'viewer', userId: VIEWER, workspaceId: WORKSPACE },
    { role: 'owner', userId: STRANGER, workspaceId: OTHER_WORKSPACE },
  ]);

  const device = (
    deviceId: string,
    userId: string,
    extra: { visibility?: 'private' | 'public'; workspaceId?: string } = {},
  ) => ({
    deviceId,
    hostname: `${deviceId}.local`,
    identitySource: 'machine-id',
    platform: 'darwin',
    userId,
    visibility: extra.visibility ?? 'private',
    workingDirs: [{ path: REPO, repoType: 'git' as const }],
    workspaceId: extra.workspaceId ?? null,
  });
  await serverDB.insert(devices).values([
    device(DEVICE.ownerPersonal, OWNER),
    device(DEVICE.strangerPersonal, STRANGER),
    device(DEVICE.wsPublic, OWNER, { visibility: 'public', workspaceId: WORKSPACE }),
    device(DEVICE.wsPrivate, OWNER, { visibility: 'private', workspaceId: WORKSPACE }),
    device(DEVICE.otherWorkspace, STRANGER, {
      visibility: 'public',
      workspaceId: OTHER_WORKSPACE,
    }),
  ]);

  const key = (value: string, userId: string, scopes: string[] | null, workspaceId?: string) => ({
    key: value,
    keyHash: hashApiKey(value),
    name: value,
    scopes,
    userId,
    workspaceId: workspaceId ?? null,
  });
  await serverDB
    .insert(apiKeys)
    .values([
      key(KEYS.read, OWNER, ['device:read']),
      key(KEYS.operate, OWNER, ['device:read', 'device:operate']),
      key(KEYS.full, OWNER, ['*']),
      key(KEYS.fullOperate, OWNER, ['*', 'device:operate']),
      key(KEYS.legacy, OWNER, null),
      key(KEYS.chatOnly, OWNER, ['chat:read']),
      key(KEYS.stranger, STRANGER, ['*', 'device:operate']),
      key(KEYS.wsOwner, OWNER, ['device:read', 'device:operate'], WORKSPACE),
      key(KEYS.wsMember, MEMBER, ['device:read', 'device:operate'], WORKSPACE),
      key(KEYS.wsViewer, VIEWER, ['device:read', 'device:operate'], WORKSPACE),
    ]);

  for (const spy of Object.values(gateway)) spy.mockReset();
  gateway.queryDeviceList.mockResolvedValue([]);
  gateway.queryDeviceMetrics.mockResolvedValue([]);
  gateway.queryDeviceSystemInfo.mockResolvedValue(undefined);
  auditLog.mockClear();
});

afterEach(() => {
  auditLog.mockClear();
});

const auditLines = () =>
  auditLog.mock.calls
    .filter(([tag]) => tag === '[openapi:audit]')
    .map(([, line]) => JSON.parse(line as string));

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials, on reads and on commands', async () => {
    for (const [path, method] of [
      ['/devices', 'GET'],
      [`/devices/${DEVICE.ownerPersonal}/commands`, 'POST'],
    ]) {
      const res = await call(path, {
        body: method === 'POST' ? { command: 'ls' } : undefined,
        method,
      });
      expect(res.status).toBe(401);
      expect((await json(res)).code).toBe('unauthorized');
    }
  });

  it('refuses a key without device:read', async () => {
    const res = await call('/devices', { key: KEYS.chatOnly });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('lets a full-access key read devices', async () => {
    expect((await call('/devices', { key: KEYS.full })).status).toBe(200);
    expect((await call('/devices', { key: KEYS.legacy })).status).toBe(200);
  });

  it('refuses every write to a key without device:operate — full access and legacy keys included', async () => {
    const writes = [
      {
        body: { command: 'ls' },
        method: 'POST',
        path: `/devices/${DEVICE.ownerPersonal}/commands`,
      },
      {
        body: { content: 'x', path: `${REPO}/a.txt`, workingDirectory: REPO },
        method: 'PUT',
        path: `/devices/${DEVICE.ownerPersonal}/files/content`,
      },
      {
        body: { action: 'pull', path: REPO },
        method: 'POST',
        path: `/devices/${DEVICE.ownerPersonal}/git/operations`,
      },
    ];

    for (const key of [KEYS.read, KEYS.full, KEYS.legacy, KEYS.chatOnly]) {
      for (const write of writes) {
        const res = await call(write.path, { body: write.body, key, method: write.method });
        const body = await json(res);
        expect(res.status, `${key} ${write.method} ${write.path}`).toBe(403);
        expect(body.code).toBe('insufficient_scope');
        expect(body.message).toContain('device:operate');
      }
    }
    expect(gateway.executeToolCall).not.toHaveBeenCalled();
    expect(gateway.writeProjectFile).not.toHaveBeenCalled();
    expect(gateway.pullGitBranch).not.toHaveBeenCalled();
  });

  it('documents the scopes on the spec: device:read for reads, device:operate for writes', async () => {
    const { buildSpecDocument } = await import('../spec');
    const spec = (await buildSpecDocument(app)) as any;

    expect(spec.paths['/api/v1/devices'].get['x-required-scopes']).toEqual(['device:read']);
    expect(spec.paths['/api/v1/devices/{id}/commands'].post['x-required-scopes']).toEqual([
      'device:operate',
    ]);
  });
});

describe('reading devices', () => {
  it('lists only the caller’s own devices', async () => {
    const res = await call('/devices', { key: KEYS.read });
    const body = await json(res);

    expect(res.status).toBe(200);
    const page = DeviceListResponseSchema.parse(body.data);
    expect(page.items.map((item) => item.id)).toEqual([DEVICE.ownerPersonal]);
    expect(page).toMatchObject({ hasMore: false, total: 1 });
    expect(page.items[0]).toMatchObject({
      online: false,
      scope: 'personal',
      workingDirectories: [{ path: REPO, repoType: 'git' }],
    });
  });

  it('returns a device with its system info and metrics', async () => {
    gateway.queryDeviceList.mockResolvedValue([
      {
        channels: [{ channel: 'desktop', connectedAt: '2026-11-18T00:00:00.000Z' }],
        deviceId: DEVICE.ownerPersonal,
        hostname: 'laptop',
        lastSeen: '2026-11-18T00:00:00.000Z',
        online: true,
        platform: 'darwin',
      } as any,
    ]);
    gateway.queryDeviceSystemInfo.mockResolvedValue({
      arch: 'arm64',
      defaultShell: 'zsh',
      desktopPath: '/Users/owner/Desktop',
      documentsPath: '/Users/owner/Documents',
      homePath: '/Users/owner',
      userDataPath: '/Users/owner/.lobehub',
      workingDirectory: REPO,
    });
    gateway.queryDeviceMetrics.mockResolvedValue([
      {
        connected: true,
        cpuCount: 10,
        cpuPercent: 12.5,
        memoryPercent: 40,
        memoryTotalBytes: 32e9,
        memoryUsedBytes: 12.8e9,
        observedAt: Date.now() - 30_000,
      } as any,
    ]);

    const res = await call(`/devices/${DEVICE.ownerPersonal}?metricsWindowMs=600000`, {
      key: KEYS.read,
    });
    const body = await json(res);

    expect(res.status).toBe(200);
    const detail = DeviceDetailSchema.parse(body.data);
    expect(detail).toMatchObject({
      id: DEVICE.ownerPersonal,
      online: true,
      systemInfo: { arch: 'arm64', defaultShell: 'zsh', homePath: '/Users/owner' },
    });
    expect(detail.metrics.cpuCount).toBe(10);
    expect(detail.metrics.points.some((point) => point.cpuPercent === 12.5)).toBe(true);
  });

  it('answers 404 for another user’s device, on every route', async () => {
    for (const path of [
      `/devices/${DEVICE.strangerPersonal}`,
      `/devices/${DEVICE.strangerPersonal}/files?root=${REPO}`,
      `/devices/${DEVICE.strangerPersonal}/git/status?path=${REPO}`,
      `/devices/${DEVICE.strangerPersonal}/git/log?path=${REPO}`,
      `/devices/${DEVICE.strangerPersonal}/git/diff?path=${REPO}`,
    ]) {
      const res = await call(path, { key: KEYS.operate });
      expect(res.status, path).toBe(404);
      expect((await json(res)).code).toBe('not_found');
    }

    const res = await call(`/devices/${DEVICE.strangerPersonal}/commands`, {
      body: { command: 'cat ~/.ssh/id_rsa' },
      key: KEYS.operate,
      method: 'POST',
    });
    expect(res.status).toBe(404);
    expect(gateway.executeToolCall).not.toHaveBeenCalled();
    expect(gateway.gitWorkingTreeStatus).not.toHaveBeenCalled();
  });

  it('validates query parameters', async () => {
    const cases = [
      `/devices/${DEVICE.ownerPersonal}/git/status`,
      `/devices/${DEVICE.ownerPersonal}/git/log?path=${REPO}&ref=--upload-pack=evil`,
      `/devices/${DEVICE.ownerPersonal}/git/log?path=${REPO}&limit=1000`,
      `/devices/${DEVICE.ownerPersonal}/files`,
      `/devices/${DEVICE.ownerPersonal}?metricsWindowMs=10`,
    ];
    for (const path of cases) {
      const res = await call(path, { key: KEYS.read });
      expect(res.status, path).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
  });
});

describe('files', () => {
  it('lists a project directory and reads a file', async () => {
    gateway.listProjectDirectory.mockResolvedValue({
      entries: [
        { isDirectory: true, name: 'src', path: `${REPO}/src`, relativePath: 'src/' },
        {
          gitIgnored: false,
          isDirectory: false,
          name: 'README.md',
          path: `${REPO}/README.md`,
          relativePath: 'README.md',
        },
      ],
      truncated: false,
    });
    gateway.getLocalFilePreview.mockResolvedValue({
      preview: { content: '# Repo', contentType: 'text/markdown', type: 'text' },
      success: true,
    });

    const list = await call(`/devices/${DEVICE.ownerPersonal}/files?root=${REPO}`, {
      key: KEYS.read,
    });
    expect(list.status).toBe(200);
    expect(DeviceFileListSchema.parse((await json(list)).data).entries).toHaveLength(2);
    expect(gateway.listProjectDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: DEVICE.ownerPersonal, relativePath: '', root: REPO }),
    );

    const file = await call(
      `/devices/${DEVICE.ownerPersonal}/files/content?workingDirectory=${REPO}&path=${REPO}/README.md`,
      { key: KEYS.read },
    );
    expect(file.status).toBe(200);
    expect(DeviceFileContentSchema.parse((await json(file)).data)).toEqual({
      content: '# Repo',
      contentType: 'text/markdown',
      encoding: 'utf8',
      path: `${REPO}/README.md`,
      type: 'text',
    });
  });

  it('refuses a file outside the device’s approved working directories', async () => {
    const res = await call(
      `/devices/${DEVICE.ownerPersonal}/files/content?workingDirectory=/etc&path=/etc/passwd`,
      { key: KEYS.read },
    );

    expect(res.status).toBe(403);
    expect(gateway.getLocalFilePreview).not.toHaveBeenCalled();
  });

  it('writes a file with device:operate and records it', async () => {
    gateway.writeProjectFile.mockResolvedValue({ success: true });

    const res = await call(`/devices/${DEVICE.ownerPersonal}/files/content`, {
      body: { content: 'hello', path: `${REPO}/notes.txt`, workingDirectory: REPO },
      key: KEYS.operate,
      method: 'PUT',
    });

    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ path: `${REPO}/notes.txt`, written: true });
    expect(auditLines()).toEqual([
      expect.objectContaining({
        action: 'device.file_written',
        resourceId: DEVICE.ownerPersonal,
        resourceType: 'device',
        userId: OWNER,
      }),
    ]);
  });
});

describe('git', () => {
  it('reads status, log and diff', async () => {
    gateway.gitWorkingTreeStatus.mockResolvedValue({
      added: 1,
      clean: false,
      deleted: 0,
      modified: 2,
      total: 3,
    });
    gateway.getGitWorkingTreeFiles.mockResolvedValue({
      added: ['new.ts'],
      deleted: [],
      modified: ['a.ts', 'b.ts'],
    });
    gateway.gitBranch.mockResolvedValue({ branch: 'feat/x', detached: false });
    gateway.gitAheadBehind.mockResolvedValue({
      ahead: 2,
      behind: 0,
      hasUpstream: true,
      upstream: 'origin/feat/x',
    });
    gateway.executeToolCall.mockResolvedValue(
      commandState(
        [
          [
            'a'.repeat(40),
            'aaaaaaa',
            'Ada',
            'ada@example.com',
            '2026-11-17T10:00:00+08:00',
            'Add x',
          ],
          [
            'b'.repeat(40),
            'bbbbbbb',
            'Bob',
            'bob@example.com',
            '2026-11-16T10:00:00+08:00',
            'Init',
          ],
        ]
          .map((fields) => fields.join('\u001F'))
          .join('\n'),
      ),
    );
    gateway.getGitWorkingTreePatches.mockResolvedValue({
      patches: [
        {
          additions: 1,
          deletions: 0,
          filePath: 'a.ts',
          isBinary: false,
          patch: '@@ -0,0 +1 @@\n+x',
          status: 'modified',
          truncated: false,
        },
      ],
    });

    const status = await call(`/devices/${DEVICE.ownerPersonal}/git/status?path=${REPO}`, {
      key: KEYS.read,
    });
    expect(status.status).toBe(200);
    expect(DeviceGitStatusSchema.parse((await json(status)).data)).toEqual({
      ahead: 2,
      behind: 0,
      branch: 'feat/x',
      clean: false,
      counts: { added: 1, deleted: 0, modified: 2, total: 3 },
      detached: false,
      files: { added: ['new.ts'], deleted: [], modified: ['a.ts', 'b.ts'] },
      upstream: 'origin/feat/x',
    });

    const log = await call(`/devices/${DEVICE.ownerPersonal}/git/log?path=${REPO}&limit=5`, {
      key: KEYS.read,
    });
    expect(log.status).toBe(200);
    const commits = DeviceGitLogSchema.parse((await json(log)).data).commits;
    expect(commits.map((commit) => commit.subject)).toEqual(['Add x', 'Init']);
    // one fixed command built by the server, sent over the device gateway path
    const [params, toolCall] = gateway.executeToolCall.mock.calls[0];
    expect(params).toMatchObject({ deviceId: DEVICE.ownerPersonal, userId: OWNER });
    expect(toolCall).toMatchObject({ apiName: 'runCommand', identifier: 'lobe-local-system' });
    expect(JSON.parse(toolCall.arguments).command).toBe(
      `git -C '${REPO}' log --max-count=5 --format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s HEAD --`,
    );

    const diff = await call(`/devices/${DEVICE.ownerPersonal}/git/diff?path=${REPO}`, {
      key: KEYS.read,
    });
    expect(diff.status).toBe(200);
    expect(DeviceGitDiffSchema.parse((await json(diff)).data).patches[0].filePath).toBe('a.ts');
    // reads are not audited
    expect(auditLines()).toEqual([]);
  });

  it('diffs the branch against its base', async () => {
    gateway.getGitBranchDiff.mockResolvedValue({
      baseRef: 'origin/canary',
      headRef: 'feat/x',
      patches: [],
      submodules: [
        {
          absolutePath: `${REPO}/vendor/lib`,
          name: 'lib',
          patches: [],
          relativePath: 'vendor/lib',
        },
      ],
    });

    const res = await call(
      `/devices/${DEVICE.ownerPersonal}/git/diff?path=${REPO}&against=branch&baseRef=origin/canary`,
      { key: KEYS.read },
    );

    expect(res.status).toBe(200);
    expect(DeviceGitDiffSchema.parse((await json(res)).data)).toEqual({
      baseRef: 'origin/canary',
      headRef: 'feat/x',
      patches: [],
      submodules: [{ name: 'lib', patches: [], relativePath: 'vendor/lib' }],
    });
    expect(gateway.getGitBranchDiff).toHaveBeenCalledWith(
      expect.objectContaining({ baseRef: 'origin/canary', path: REPO }),
    );
  });

  it('answers 503 when the device is offline', async () => {
    gateway.gitWorkingTreeStatus.mockResolvedValue(undefined);

    const res = await call(`/devices/${DEVICE.ownerPersonal}/git/status?path=${REPO}`, {
      key: KEYS.read,
    });
    expect(res.status).toBe(503);
  });

  it('checks out a branch with device:operate and records it; rejects an unknown action', async () => {
    gateway.checkoutGitBranch.mockResolvedValue({ success: true });

    const res = await call(`/devices/${DEVICE.ownerPersonal}/git/operations`, {
      body: { action: 'checkout', branch: 'feat/y', create: true, path: REPO },
      key: KEYS.operate,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(DeviceGitOperationResultSchema.parse((await json(res)).data)).toEqual({
      action: 'checkout',
      branch: 'feat/y',
      error: null,
      noop: false,
      success: true,
    });
    expect(auditLines()).toEqual([
      expect.objectContaining({
        action: 'device.git_operated',
        metadata: expect.objectContaining({ action: 'checkout', branch: 'feat/y' }),
      }),
    ]);

    const bad = await call(`/devices/${DEVICE.ownerPersonal}/git/operations`, {
      body: { action: 'reset --hard', path: REPO },
      key: KEYS.operate,
      method: 'POST',
    });
    expect(bad.status).toBe(400);
  });
});

describe('commands', () => {
  it('runs a command through the device gateway with device:operate, and audits it', async () => {
    gateway.executeToolCall.mockResolvedValue(commandState('hello\n'));

    const res = await call(`/devices/${DEVICE.ownerPersonal}/commands`, {
      body: { command: 'echo hello', timeoutMs: 5000 },
      key: KEYS.operate,
      method: 'POST',
    });
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(DeviceCommandResultSchema.parse(body.data)).toEqual({
      exitCode: 0,
      output: 'hello\n',
      running: false,
      shellId: null,
      stderr: null,
      stdout: 'hello\n',
      success: true,
    });
    const [params, toolCall, timeout] = gateway.executeToolCall.mock.calls[0];
    expect(params).toEqual({
      deviceId: DEVICE.ownerPersonal,
      userId: OWNER,
      workspaceId: undefined,
    });
    expect(toolCall).toMatchObject({ apiName: 'runCommand', identifier: 'lobe-local-system' });
    expect(JSON.parse(toolCall.arguments)).toMatchObject({ command: 'echo hello', timeout: 5000 });
    expect(timeout).toBe(20_000);

    const [entry] = auditLines();
    expect(entry).toMatchObject({
      action: 'device.command_executed',
      metadata: {
        apiKeyId: expect.any(String),
        authType: 'apikey',
        command: 'echo hello',
        exitCode: 0,
        success: true,
        via: 'openapi',
      },
      resourceId: DEVICE.ownerPersonal,
      resourceType: 'device',
      userId: OWNER,
      workspaceId: null,
    });
  });

  it('accepts a full-access key that also holds device:operate', async () => {
    gateway.executeToolCall.mockResolvedValue(commandState('ok'));

    const res = await call(`/devices/${DEVICE.ownerPersonal}/commands`, {
      body: { command: 'true' },
      key: KEYS.fullOperate,
      method: 'POST',
    });
    expect(res.status).toBe(200);
  });

  it('answers 503 when the gateway cannot reach the device, and still audits the attempt', async () => {
    gateway.executeToolCall.mockResolvedValue({
      content: 'Device is offline',
      error: 'DEVICE_OFFLINE',
      success: false,
    });

    const res = await call(`/devices/${DEVICE.ownerPersonal}/commands`, {
      body: { command: 'ls' },
      key: KEYS.operate,
      method: 'POST',
    });
    expect(res.status).toBe(503);
    expect(auditLines()[0]).toMatchObject({
      action: 'device.command_executed',
      metadata: { error: 'Device is offline', success: false },
    });
  });

  it('validates the body', async () => {
    for (const body of [{}, { command: '   ' }, { command: 'ls', timeoutMs: 10 }]) {
      const res = await call(`/devices/${DEVICE.ownerPersonal}/commands`, {
        body,
        key: KEYS.operate,
        method: 'POST',
      });
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
    expect(gateway.executeToolCall).not.toHaveBeenCalled();
  });
});

describe('workspace devices', () => {
  it('lists the workspace’s devices and writes the audit entry to the workspace log', async () => {
    gateway.executeToolCall.mockResolvedValue(commandState('done'));

    const list = await json(await call('/devices', { key: KEYS.wsOwner, workspaceId: WORKSPACE }));
    expect(list.data.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [DEVICE.wsPrivate, DEVICE.wsPublic].sort(),
    );

    const res = await call(`/devices/${DEVICE.wsPublic}/commands`, {
      body: { command: 'make build' },
      key: KEYS.wsOwner,
      method: 'POST',
      workspaceId: WORKSPACE,
    });
    expect(res.status).toBe(200);
    expect(gateway.executeToolCall.mock.calls[0][0]).toMatchObject({
      deviceId: DEVICE.wsPublic,
      workspaceId: WORKSPACE,
    });

    const rows = await serverDB.select().from(workspaceAuditLogs);
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'device.command_executed',
        resourceId: DEVICE.wsPublic,
        resourceType: 'device',
        userId: OWNER,
        workspaceId: WORKSPACE,
      }),
    ]);
    expect(rows[0].metadata).toMatchObject({ command: 'make build', via: 'openapi' });
  });

  it('hides another workspace’s devices and a personal device behind the workspace header', async () => {
    for (const id of [DEVICE.otherWorkspace, DEVICE.ownerPersonal]) {
      const res = await call(`/devices/${id}/commands`, {
        body: { command: 'ls' },
        key: KEYS.wsOwner,
        method: 'POST',
        workspaceId: WORKSPACE,
      });
      expect(res.status, id).toBe(404);
    }

    const otherWorkspace = await call('/devices', {
      key: KEYS.wsOwner,
      workspaceId: OTHER_WORKSPACE,
    });
    expect(otherWorkspace.status).toBe(403);
    expect(gateway.executeToolCall).not.toHaveBeenCalled();
  });

  it('lets a member operate a public device but not see another member’s private one', async () => {
    gateway.executeToolCall.mockResolvedValue(commandState('ok'));

    const visible = await call(`/devices/${DEVICE.wsPublic}/commands`, {
      body: { command: 'ls' },
      key: KEYS.wsMember,
      method: 'POST',
      workspaceId: WORKSPACE,
    });
    expect(visible.status).toBe(200);

    const hidden = await call(`/devices/${DEVICE.wsPrivate}/commands`, {
      body: { command: 'ls' },
      key: KEYS.wsMember,
      method: 'POST',
      workspaceId: WORKSPACE,
    });
    expect(hidden.status).toBe(404);
  });

  it('refuses a viewer operating even a public device', async () => {
    const res = await call(`/devices/${DEVICE.wsPublic}/commands`, {
      body: { command: 'ls' },
      key: KEYS.wsViewer,
      method: 'POST',
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(403);
    expect(gateway.executeToolCall).not.toHaveBeenCalled();
  });
});

describe('granting device:operate', () => {
  it('stops a full-access key from minting a key with device:operate', async () => {
    const res = await call('/api-keys', {
      body: { name: 'escalate', scopes: ['*', 'device:operate'] },
      key: KEYS.full,
      method: 'POST',
    });

    expect(res.status).toBe(403);
    expect((await json(res)).message).toContain('device:operate');
  });

  it('keeps device:operate beside full access when a key holding it mints one', async () => {
    const res = await call('/api-keys', {
      body: { name: 'operator', scopes: ['*', 'device:operate', 'chat:read'] },
      key: KEYS.fullOperate,
      method: 'POST',
    });

    expect(res.status).toBe(201);
    expect((await json(res)).data.scopes).toEqual(['*', 'device:operate']);
  });
});
