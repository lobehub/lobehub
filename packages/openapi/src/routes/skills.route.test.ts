// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SkillServiceModule from '@/server/services/skill';

/**
 * `/api/v1/skills` over real HTTP: the real routes behind the `app.ts` auth and
 * workspace middlewares, the real permission/scope gates, controller, REST
 * service and the shared `agentSkills` procedures, on PGlite. API keys are real
 * `api_keys` rows. Only the database handle is pointed at PGlite, and the
 * importer's network fetch is stubbed for the import case.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));
const importFromUrl = vi.hoisted(() => vi.fn());

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));
// File storage is S3 in production; resource bytes come from this stub.
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileContentByHash = async (hash: string) => `content of ${hash}`;
    getFullFileUrl = async () => null;
  },
}));
vi.mock('@/server/services/skill', async (importOriginal) => {
  const actual = await importOriginal<typeof SkillServiceModule>();
  return {
    ...actual,
    SkillImporter: class extends actual.SkillImporter {
      importFromUrl = importFromUrl;
    },
  };
});

const { getTestDB } = await import('@/database/core/getTestDB');
const { agentSkills, apiKeys, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { SkillImportResultSchema, SkillListSchema, SkillSchema } =
  await import('../types/skill.type');
const SkillRoutes = (await import('./skills.route')).default;

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
app.route('/skills', SkillRoutes);

const OWNER = 'r7-skills-owner';
const STRANGER = 'r7-skills-stranger';
const WORKSPACE = 'r7-skills-ws';

const KEYS = {
  chatOnly: 'sk-lh-r7skillschatonl1',
  ownerRead: 'sk-lh-r7skillsownerre1',
  ownerWrite: 'sk-lh-r7skillsownerwr1',
  stranger: 'sk-lh-r7skillsstrange1',
  workspace: 'sk-lh-r7skillsworkspa1',
} as const;

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

const createSkill = async (body: Record<string, unknown> = {}, key: string = KEYS.ownerWrite) =>
  call('/skills', {
    body: {
      content: '# Review\n\nCheck every changed file.',
      description: 'Reviews a pull request',
      name: 'Code Review',
      ...body,
    },
    key,
    method: 'POST',
  });

beforeEach(async () => {
  importFromUrl.mockReset();
  await serverDB.delete(agentSkills);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: WORKSPACE, name: 'R7 skills', primaryOwnerId: OWNER, slug: 'r7-skills' }]);
  await serverDB
    .insert(workspaceMembers)
    .values([{ role: 'owner', userId: OWNER, workspaceId: WORKSPACE }]);
  const key = (value: string, userId: string, scopes: string[], workspaceId?: string) => ({
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
      key(KEYS.ownerWrite, OWNER, ['agent:write']),
      key(KEYS.ownerRead, OWNER, ['agent:read']),
      key(KEYS.chatOnly, OWNER, ['chat:write']),
      key(KEYS.stranger, STRANGER, ['agent:write']),
      key(KEYS.workspace, OWNER, ['agent:write'], WORKSPACE),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    expect((await call('/skills')).status).toBe(401);
  });

  it('refuses a key without an agent scope', async () => {
    const res = await call('/skills', { key: KEYS.chatOnly });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('lets an agent:read key list but not write', async () => {
    expect((await call('/skills', { key: KEYS.ownerRead })).status).toBe(200);

    const res = await createSkill({}, KEYS.ownerRead);
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });
});

describe('request validation', () => {
  it('rejects a create without a name', async () => {
    const res = await call('/skills', {
      body: { content: 'x', description: 'd' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('validation_error');
  });

  it('rejects an empty update and an unknown import source', async () => {
    const created = (await json(await createSkill())).data;
    const empty = await call(`/skills/${created.id}`, {
      body: {},
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(empty.status).toBe(400);

    const badSource = await call('/skills/import', {
      body: { source: 'ftp', url: 'ftp://example.com/skill.zip' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(badSource.status).toBe(400);
    expect((await json(badSource)).code).toBe('validation_error');
  });
});

describe('CRUD', () => {
  it('creates, reads, searches, updates and deletes a skill', async () => {
    const res = await createSkill();
    expect(res.status).toBe(201);
    const created = (await json(res)).data;
    expect(() => SkillSchema.parse(created)).not.toThrow();
    expect(created).toMatchObject({
      content: '# Review\n\nCheck every changed file.',
      manifest: { description: 'Reviews a pull request', name: 'Code Review' },
      name: 'Code Review',
      resources: [],
      source: 'user',
    });

    await createSkill({ description: 'Writes release notes', name: 'Changelog' });

    const list = (await json(await call('/skills?limit=1', { key: KEYS.ownerRead }))).data;
    expect(() => SkillListSchema.parse(list)).not.toThrow();
    expect(list).toMatchObject({ hasMore: true, total: 2 });
    const next = (
      await json(await call(`/skills?limit=1&cursor=${list.nextCursor}`, { key: KEYS.ownerRead }))
    ).data;
    expect(next).toMatchObject({ hasMore: false, nextCursor: null });
    expect([...list.items, ...next.items].map((s: any) => s.name).sort()).toEqual([
      'Changelog',
      'Code Review',
    ]);

    const search = (await json(await call('/skills?q=release', { key: KEYS.ownerRead }))).data;
    expect(search.items.map((s: any) => s.name)).toEqual(['Changelog']);

    const updated = await call(`/skills/${created.id}`, {
      body: { content: '# Review v2', manifest: { name: 'Deep Review', version: '2.0.0' } },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(updated.status).toBe(200);
    expect((await json(updated)).data).toMatchObject({
      content: '# Review v2',
      manifest: { name: 'Deep Review', version: '2.0.0' },
      name: 'Deep Review',
    });

    const deleted = await call(`/skills/${created.id}`, { key: KEYS.ownerWrite, method: 'DELETE' });
    expect((await json(deleted)).data).toEqual({ deleted: true, id: created.id });
    expect((await call(`/skills/${created.id}`, { key: KEYS.ownerRead })).status).toBe(404);
  });

  it('reads a resource file and 404s a path the skill does not ship', async () => {
    const created = (await json(await createSkill())).data;
    // The importer stores resources as content-addressed files.
    await serverDB
      .update(agentSkills)
      .set({ resources: { 'notes.md': { content: '# Notes', fileHash: 'h1', size: 7 } } as any });

    const detail = (await json(await call(`/skills/${created.id}`, { key: KEYS.ownerRead }))).data;
    expect(detail.resources).toEqual([{ path: 'notes.md', size: 7 }]);

    const listed = await call(`/skills/${created.id}/resources`, { key: KEYS.ownerRead });
    expect((await json(listed)).data).toEqual({ items: [{ path: 'notes.md', size: 7 }] });
    expect((await call(`/skills/${created.id}/resources`)).status).toBe(401);
    expect((await call(`/skills/${created.id}/resources`, { key: KEYS.stranger })).status).toBe(
      404,
    );
    expect(
      (await call(`/skills/${created.id}/resource?path=notes.md`, { key: KEYS.stranger })).status,
    ).toBe(404);
    // `path` is required
    expect((await call(`/skills/${created.id}/resource`, { key: KEYS.ownerRead })).status).toBe(
      400,
    );

    const read = await call(`/skills/${created.id}/resource?path=notes.md`, {
      key: KEYS.ownerRead,
    });
    expect(read.status).toBe(200);
    expect((await json(read)).data).toMatchObject({
      content: 'content of h1',
      encoding: 'utf8',
      path: 'notes.md',
    });

    const missing = await call(`/skills/${created.id}/resource?path=nope.md`, {
      key: KEYS.ownerRead,
    });
    expect(missing.status).toBe(404);
  });
});

describe('import', () => {
  it('imports from a URL through the shared importer', async () => {
    importFromUrl.mockResolvedValue({
      skill: {
        content: '# Imported',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        description: 'From the web',
        id: 'skill_imported',
        identifier: 'web-skill',
        manifest: { description: 'From the web', name: 'Web Skill', sourceUrl: 'https://x.dev' },
        name: 'Web Skill',
        resources: {},
        source: 'user',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      status: 'created',
    });

    const res = await call('/skills/import', {
      body: { source: 'url', url: 'https://example.com/SKILL.md' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const data = (await json(res)).data;
    expect(() => SkillImportResultSchema.parse(data)).not.toThrow();
    expect(data).toMatchObject({ skill: { identifier: 'web-skill' }, status: 'created' });
    expect(importFromUrl).toHaveBeenCalledWith({ url: 'https://example.com/SKILL.md' });
  });

  it('refuses an import with an agent:read key before reaching the importer', async () => {
    const res = await call('/skills/import', {
      body: { source: 'url', url: 'https://example.com/SKILL.md' },
      key: KEYS.ownerRead,
      method: 'POST',
    });
    expect(res.status).toBe(403);
    expect(importFromUrl).not.toHaveBeenCalled();
  });
});

describe('ownership and workspace isolation', () => {
  it("hides another user's skill on read, update and delete", async () => {
    const created = (await json(await createSkill())).data;

    expect((await call(`/skills/${created.id}`, { key: KEYS.stranger })).status).toBe(404);
    expect(
      (
        await call(`/skills/${created.id}`, {
          body: { content: 'hijack' },
          key: KEYS.stranger,
          method: 'PATCH',
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(`/skills/${created.id}`, { key: KEYS.stranger, method: 'DELETE' })).status,
    ).toBe(404);
    const strangerList = (await json(await call('/skills', { key: KEYS.stranger }))).data;
    expect(strangerList.total).toBe(0);
  });

  it('keeps personal and workspace skills apart', async () => {
    const personal = (await json(await createSkill())).data;
    const shared = (await json(await createSkill({ name: 'Team Skill' }, KEYS.workspace))).data;

    expect((await call(`/skills/${personal.id}`, { key: KEYS.workspace })).status).toBe(404);
    expect((await call(`/skills/${shared.id}`, { key: KEYS.ownerWrite })).status).toBe(404);

    const workspaceList = (await json(await call('/skills', { key: KEYS.workspace }))).data;
    expect(workspaceList.items.map((s: any) => s.id)).toEqual([shared.id]);
  });

  it('refuses a workspace header the key does not belong to', async () => {
    const res = await call('/skills', { key: KEYS.stranger, workspaceId: WORKSPACE });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });
});
