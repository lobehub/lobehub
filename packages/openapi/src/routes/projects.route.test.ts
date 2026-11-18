// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/projects` over real HTTP: the real routes behind the `app.ts` auth
 * and workspace middlewares, the real RBAC / API-key scope gates, controller,
 * REST service and the shared `project` tRPC procedures, on PGlite. API keys
 * are real `api_keys` rows; only the database handle is pointed at PGlite.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { agents, apiKeys, knowledgeBases, projects, users, workspaceMembers, workspaces, works } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { DeletedResourceSchema } = await import('../types/common.type');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const {
  ProjectAgentBindingSchema,
  ProjectAgentListResponseSchema,
  ProjectCompletionReviewListResponseSchema,
  ProjectKnowledgeBaseListResponseSchema,
  ProjectListResponseSchema,
  ProjectSchema,
} = await import('../types/project.type');
const ProjectRoutes = (await import('./projects.route')).default;

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
app.route('/projects', ProjectRoutes);

const OWNER = 'r11-project-owner';
const STRANGER = 'r11-project-stranger';
const WORKSPACE = 'ws_r11_projects';
const OTHER_WORKSPACE = 'ws_r11_projects_other';
const WORK = 'work_r11_issue';

const KEYS = {
  agentOnly: 'sk-lh-r11pagentonly001',
  ownerRead: 'sk-lh-r11pownerread001',
  ownerWrite: 'sk-lh-r11pownerwrite01',
  stranger: 'sk-lh-r11pstranger0001',
  workspace: 'sk-lh-r11pworkspace001',
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

const createProject = async (body: Record<string, unknown> = {}, key: string = KEYS.ownerWrite) => {
  const res = await call('/projects', {
    body: { name: 'Launch', ...body },
    key,
    method: 'POST',
  });
  expect(res.status).toBe(201);
  return (await json(res)).data;
};

const listWorkIds = async (projectId: string) => {
  const res = await call(`/projects/${projectId}/works`, { key: KEYS.ownerRead });
  expect(res.status).toBe(200);
  return (await json(res)).data.items.map((item: any) => item.workId);
};

const createProjectWithWork = async () => {
  const project = await createProject({ visibility: 'private' });
  const added = await call(`/projects/${project.id}/works`, {
    body: { workId: WORK },
    key: KEYS.ownerWrite,
    method: 'POST',
  });
  expect(added.status).toBe(201);
  expect(await listWorkIds(project.id)).toEqual([WORK]);
  return project;
};

beforeEach(async () => {
  await serverDB.delete(projects);
  await serverDB.delete(knowledgeBases);
  await serverDB.delete(agents);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB.insert(workspaces).values([
    { id: WORKSPACE, name: 'Team', primaryOwnerId: OWNER, slug: 'r11-team' },
    { id: OTHER_WORKSPACE, name: 'Other', primaryOwnerId: STRANGER, slug: 'r11-other' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'owner', userId: STRANGER, workspaceId: OTHER_WORKSPACE },
  ]);
  await serverDB.insert(agents).values([
    { id: 'agt_r11_helper', slug: 'r11-helper', title: 'Helper', userId: OWNER },
    { id: 'agt_r11_stranger', slug: 'r11-stranger', title: 'Not yours', userId: STRANGER },
  ]);
  await serverDB.insert(knowledgeBases).values([
    { id: 'kb_r11_docs', name: 'Docs', userId: OWNER },
    { id: 'kb_r11_stranger', name: 'Not yours', userId: STRANGER },
  ]);
  await serverDB.insert(works).values({
    id: WORK,
    identifier: 'lobehub/lobehub#1',
    resourceId: 'lobehub/lobehub#1',
    resourceType: 'github_issue',
    title: 'Ship the launch',
    toolIdentifier: 'github',
    toolName: 'createIssue',
    type: 'external',
    userId: OWNER,
    visibility: 'private',
  });
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
      key(KEYS.ownerWrite, OWNER, ['project:write']),
      key(KEYS.ownerRead, OWNER, ['project:read']),
      key(KEYS.agentOnly, OWNER, ['agent:write']),
      key(KEYS.stranger, STRANGER, ['project:write']),
      key(KEYS.workspace, OWNER, ['project:write'], WORKSPACE),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    const res = await call('/projects');

    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe('unauthorized');
  });

  it('refuses a key without a project scope, even one holding agent:write', async () => {
    const res = await call('/projects', { key: KEYS.agentOnly });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('lets project:read list but not write', async () => {
    expect((await call('/projects', { key: KEYS.ownerRead })).status).toBe(200);

    const res = await call('/projects', {
      body: { name: 'Nope' },
      key: KEYS.ownerRead,
      method: 'POST',
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });
});

describe('request validation', () => {
  it('rejects a missing name, a bad slug and a bad identifier', async () => {
    for (const body of [{}, { name: 'X', slug: 'Not A Slug' }, { identifier: '1x', name: 'X' }]) {
      const res = await call('/projects', { body, key: KEYS.ownerWrite, method: 'POST' });
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
  });

  it('refuses completing a project through the status endpoint', async () => {
    const project = await createProject();
    const res = await call(`/projects/${project.id}/status`, {
      body: { status: 'completed' },
      key: KEYS.ownerWrite,
      method: 'PUT',
    });

    expect(res.status).toBe(400);
  });

  it('needs a comment to reject a completion', async () => {
    const project = await createProject();
    const res = await call(`/projects/${project.id}/completion-reviews`, {
      body: { decision: 'rejected' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });
});

describe('project lifecycle', () => {
  it('creates, reads by id / slug / identifier, lists, updates and deletes', async () => {
    const project = await createProject({ identifier: 'lnch', slug: 'launch-plan' });

    expect(ProjectSchema.parse(project)).toMatchObject({
      identifier: 'LNCH',
      name: 'Launch',
      slug: 'launch-plan',
      status: 'backlog',
      userId: OWNER,
      workspaceId: null,
    });
    expect(project.coordinatorAgentId).toEqual(expect.any(String));

    for (const reference of [project.id, 'launch-plan', 'lnch']) {
      const res = await call(`/projects/${reference}`, { key: KEYS.ownerRead });
      expect(res.status).toBe(200);
      expect((await json(res)).data.id).toBe(project.id);
    }

    const list = await json(await call('/projects?limit=10', { key: KEYS.ownerRead }));
    expect(ProjectListResponseSchema.parse(list.data).items.map((item) => item.id)).toEqual([
      project.id,
    ]);
    expect(list.data.hasMore).toBe(false);

    const updated = await json(
      await call(`/projects/${project.id}`, {
        body: { description: 'Ship it' },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
    );
    expect(updated.data.description).toBe('Ship it');

    const deleted = await call(`/projects/${project.id}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect(deleted.status).toBe(200);
    expect((await json(deleted)).data).toEqual({ deleted: true, id: project.id });
    expect((await call(`/projects/${project.id}`, { key: KEYS.ownerRead })).status).toBe(404);
  });

  it('answers 409 for a taken identifier', async () => {
    await createProject({ identifier: 'DUPE' });
    const res = await call('/projects', {
      body: { identifier: 'dupe', name: 'Again' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    expect(res.status).toBe(409);
  });

  it('filters by status and walks the completion review', async () => {
    const project = await createProject();
    const active = await json(
      await call(`/projects/${project.id}/status`, {
        body: { status: 'active' },
        key: KEYS.ownerWrite,
        method: 'PUT',
      }),
    );
    expect(active.data.status).toBe('active');

    const filtered = await json(
      await call('/projects?status=active,paused', { key: KEYS.ownerRead }),
    );
    expect(filtered.data.items.map((item: any) => item.id)).toEqual([project.id]);
    const none = await json(await call('/projects?status=backlog', { key: KEYS.ownerRead }));
    expect(none.data.items).toEqual([]);

    const requested = await json(
      await call(`/projects/${project.id}/completion-request`, {
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
    );
    expect(requested.data.status).toBe('reviewing');

    const rejected = await json(
      await call(`/projects/${project.id}/completion-reviews`, {
        body: { comment: 'Docs are missing', decision: 'rejected' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
    );
    expect(rejected.data.status).toBe('active');

    await call(`/projects/${project.id}/completion-request`, {
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    const accepted = await json(
      await call(`/projects/${project.id}/completion-reviews`, {
        body: { decision: 'accepted' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
    );
    expect(accepted.data.status).toBe('completed');
    expect(accepted.data.completedAt).toEqual(expect.any(String));

    const reviews = await json(
      await call(`/projects/${project.id}/completion-reviews`, { key: KEYS.ownerRead }),
    );
    expect(
      ProjectCompletionReviewListResponseSchema.parse(reviews.data).items.map((review) => [
        review.round,
        review.decision,
      ]),
    ).toEqual([
      [2, 'accepted'],
      [1, 'rejected'],
    ]);

    const reopened = await json(
      await call(`/projects/${project.id}/reopen`, { key: KEYS.ownerWrite, method: 'POST' }),
    );
    expect(reopened.data.status).toBe('active');
  });
});

describe('member agents, knowledge bases and works', () => {
  it('adds, lists, updates and removes a member agent', async () => {
    const project = await createProject({ visibility: 'private' });

    const added = await call(`/projects/${project.id}/agents`, {
      body: { agentId: 'agt_r11_helper', role: 'Reviewer' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(added.status).toBe(201);
    expect(ProjectAgentBindingSchema.parse((await json(added)).data)).toMatchObject({
      agentId: 'agt_r11_helper',
      enabled: true,
      role: 'Reviewer',
    });

    const list = await json(await call(`/projects/${project.id}/agents`, { key: KEYS.ownerRead }));
    const items = ProjectAgentListResponseSchema.parse(list.data).items;
    expect(items.map((item) => item.agentId)).toEqual([
      project.coordinatorAgentId,
      'agt_r11_helper',
    ]);
    expect(items[1].agent.title).toBe('Helper');

    const updated = await json(
      await call(`/projects/${project.id}/agents/agt_r11_helper`, {
        body: { enabled: false },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
    );
    expect(updated.data.enabled).toBe(false);

    const removed = await json(
      await call(`/projects/${project.id}/agents/agt_r11_helper`, {
        key: KEYS.ownerWrite,
        method: 'DELETE',
      }),
    );
    expect(removed.data).toEqual({ deleted: true, id: 'agt_r11_helper' });
    expect(
      (
        await call(`/projects/${project.id}/agents/agt_r11_helper`, {
          key: KEYS.ownerWrite,
          method: 'DELETE',
        })
      ).status,
    ).toBe(404);
  });

  it("refuses another account's agent and knowledge base", async () => {
    const project = await createProject({ visibility: 'private' });

    const agent = await call(`/projects/${project.id}/agents`, {
      body: { agentId: 'agt_r11_stranger' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    const knowledgeBase = await call(`/projects/${project.id}/knowledge-bases`, {
      body: { knowledgeBaseId: 'kb_r11_stranger' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    expect(agent.status).toBe(400);
    expect(knowledgeBase.status).toBe(400);
  });

  it('links, lists, updates and unlinks a knowledge base', async () => {
    const project = await createProject({ visibility: 'private' });

    const added = await call(`/projects/${project.id}/knowledge-bases`, {
      body: { knowledgeBaseId: 'kb_r11_docs' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(added.status).toBe(201);

    const list = await json(
      await call(`/projects/${project.id}/knowledge-bases`, { key: KEYS.ownerRead }),
    );
    expect(ProjectKnowledgeBaseListResponseSchema.parse(list.data).items).toEqual([
      expect.objectContaining({
        enabled: true,
        knowledgeBase: expect.objectContaining({ id: 'kb_r11_docs', name: 'Docs' }),
      }),
    ]);

    const updated = await json(
      await call(`/projects/${project.id}/knowledge-bases/kb_r11_docs`, {
        body: { enabled: false },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
    );
    expect(updated.data.enabled).toBe(false);

    const removed = await json(
      await call(`/projects/${project.id}/knowledge-bases/kb_r11_docs`, {
        key: KEYS.ownerWrite,
        method: 'DELETE',
      }),
    );
    expect(removed.data).toEqual({ deleted: true, id: 'kb_r11_docs' });
  });

  it('lists no works for a new project and refuses an unknown work', async () => {
    const project = await createProject();

    const list = await json(await call(`/projects/${project.id}/works`, { key: KEYS.ownerRead }));
    expect(list.data.items).toEqual([]);

    const res = await call(`/projects/${project.id}/works`, {
      body: { workId: 'work_missing' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(res.status).toBe(400);
  });

  it('removes a linked work and keeps the work itself', async () => {
    const project = await createProjectWithWork();

    const res = await call(`/projects/${project.id}/works/${WORK}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(DeletedResourceSchema.parse((await json(res)).data)).toEqual({
      deleted: true,
      id: WORK,
    });

    expect(await listWorkIds(project.id)).toEqual([]);
    expect(await serverDB.query.works.findFirst({ where: (t, { eq }) => eq(t.id, WORK) })).toEqual(
      expect.objectContaining({ id: WORK }),
    );
  });

  it('answers 404 for an unknown work and leaves the linked one', async () => {
    const project = await createProjectWithWork();

    const res = await call(`/projects/${project.id}/works/work_missing`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
    expect(await listWorkIds(project.id)).toEqual([WORK]);
  });

  it('needs credentials and project:write to remove a work', async () => {
    const project = await createProjectWithWork();

    const anonymous = await call(`/projects/${project.id}/works/${WORK}`, { method: 'DELETE' });
    expect(anonymous.status).toBe(401);
    expect((await json(anonymous)).code).toBe('unauthorized');

    const readOnly = await call(`/projects/${project.id}/works/${WORK}`, {
      key: KEYS.ownerRead,
      method: 'DELETE',
    });
    expect(readOnly.status).toBe(403);
    expect((await json(readOnly)).code).toBe('insufficient_scope');

    expect(await listWorkIds(project.id)).toEqual([WORK]);
  });
});

describe('ownership and workspace isolation', () => {
  it("hides another account's project from every operation", async () => {
    const project = await createProject({ visibility: 'private' });

    const attempts = [
      call(`/projects/${project.id}`, { key: KEYS.stranger }),
      call(`/projects/${project.id}`, {
        body: { name: 'Mine' },
        key: KEYS.stranger,
        method: 'PATCH',
      }),
      call(`/projects/${project.id}`, { key: KEYS.stranger, method: 'DELETE' }),
      call(`/projects/${project.id}/agents`, { key: KEYS.stranger }),
      call(`/projects/${project.id}/works`, { key: KEYS.stranger }),
      call(`/projects/${project.id}/completion-request`, { key: KEYS.stranger, method: 'POST' }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);

    const list = await json(await call('/projects', { key: KEYS.stranger }));
    expect(list.data.items).toEqual([]);
    expect((await call(`/projects/${project.id}`, { key: KEYS.ownerRead })).status).toBe(200);
  });

  it("refuses removing a work from another account's or another scope's project", async () => {
    const project = await createProjectWithWork();

    const attempts = [
      call(`/projects/${project.id}/works/${WORK}`, { key: KEYS.stranger, method: 'DELETE' }),
      call(`/projects/${project.id}/works/${WORK}`, { key: KEYS.workspace, method: 'DELETE' }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);

    expect(await listWorkIds(project.id)).toEqual([WORK]);
  });

  it('refuses a personal key on a workspace and a workspace key on another workspace', async () => {
    const personal = await call('/projects', { key: KEYS.ownerWrite, workspaceId: WORKSPACE });
    const otherWorkspace = await call('/projects', {
      key: KEYS.workspace,
      workspaceId: OTHER_WORKSPACE,
    });

    for (const res of [personal, otherWorkspace]) {
      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('workspace_mismatch');
    }
  });

  it('keeps personal and workspace projects apart', async () => {
    const personal = await createProject({ name: 'Personal' });
    const team = await createProject({ name: 'Team' }, KEYS.workspace);

    expect(team.workspaceId).toBe(WORKSPACE);
    expect((await call(`/projects/${personal.id}`, { key: KEYS.workspace })).status).toBe(404);
    expect((await call(`/projects/${team.id}`, { key: KEYS.ownerRead })).status).toBe(404);

    const workspaceList = await json(await call('/projects', { key: KEYS.workspace }));
    expect(workspaceList.data.items.map((item: any) => item.id)).toEqual([team.id]);
  });
});
