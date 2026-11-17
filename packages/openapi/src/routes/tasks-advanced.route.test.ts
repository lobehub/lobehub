// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

/**
 * Task sub-resources over real HTTP: the real `TaskRoutes` (with the mounted
 * sub-resource routes) behind the auth + workspace middlewares `app.ts` mounts,
 * the real permission / scope gates, controllers, REST services and the `task`
 * tRPC procedures they call, on a PGlite database. API keys are real
 * `api_keys` rows, so scope narrowing and workspace binding run as in
 * production. Every success body is parsed with its documented response
 * schema (strict), so a drifting field fails here.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, documents, tasks, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { DeletedResourceSchema } = await import('../types/common.type');
const { TaskSchema } = await import('../types/task.type');
const {
  SubtaskOrderSchema,
  TaskCheckpointConfigSchema,
  TaskCheckpointSchema,
  TaskCommentSchema,
  TaskDependencySchema,
  TaskPinnedDocumentSchema,
  TaskReviewConfigSchema,
  TaskVerifySchema,
} = await import('../types/task-advanced.type');
const TaskRoutes = (await import('./tasks.route')).default;

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
app.route('/tasks', TaskRoutes);

const OWNER = 'r10-task-owner';
const MEMBER = 'r10-task-member';
const STRANGER = 'r10-task-stranger';
const WORKSPACE = 'r10-task-ws';

/** `sk-lh-` + 16 lowercase alphanumerics — the format the auth middleware checks. */
const KEYS = {
  chatOnly: 'sk-lh-r10taskchatonly1',
  member: 'sk-lh-r10taskmember001',
  ownerRead: 'sk-lh-r10taskownerrd01',
  ownerWrite: 'sk-lh-r10taskownerwr01',
  stranger: 'sk-lh-r10taskstranger1',
  workspaceOwner: 'sk-lh-r10taskwsowner01',
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

/** Assert the status and parse `data` with the documented schema. */
const expectData = async <T extends z.ZodType>(res: Response, status: number, schema: T) => {
  const body = (await res.json()) as any;
  expect(res.status, JSON.stringify(body)).toBe(status);
  return schema.parse(body.data) as z.infer<T>;
};

const expectError = async (res: Response, status: number, code?: string) => {
  const body = (await res.json()) as any;
  expect(res.status, JSON.stringify(body)).toBe(status);
  if (code) expect(body.code).toBe(code);
  return body;
};

const createTask = async (
  body: Record<string, unknown>,
  init: { key?: string; workspaceId?: string } = {},
) =>
  expectData(
    await call('/tasks', { body, key: init.key ?? KEYS.ownerWrite, method: 'POST', ...init }),
    201,
    TaskSchema,
  );

beforeEach(async () => {
  await serverDB.delete(tasks);
  await serverDB.delete(documents);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: MEMBER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: WORKSPACE, name: 'R10 tasks', primaryOwnerId: OWNER, slug: 'r10-tasks' }]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'member', userId: MEMBER, workspaceId: WORKSPACE },
  ]);
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
      key(KEYS.chatOnly, OWNER, ['chat:read']),
      key(KEYS.stranger, STRANGER, ['agent:write']),
      key(KEYS.workspaceOwner, OWNER, ['agent:write'], WORKSPACE),
      key(KEYS.member, MEMBER, ['agent:write'], WORKSPACE),
    ]);
});

describe('authentication and scopes', () => {
  it('answers 401 without credentials', async () => {
    await expectError(await call('/tasks/T-1/subtasks'), 401);
  });

  it('refuses a key without any agent scope on a read', async () => {
    const parent = await createTask({ instruction: 'parent' });

    await expectError(
      await call(`/tasks/${parent.id}/comments`, { key: KEYS.chatOnly }),
      403,
      'insufficient_scope',
    );
  });

  it('refuses a read-only key on every kind of write', async () => {
    const parent = await createTask({ instruction: 'parent' });
    const writes: [string, string, unknown][] = [
      ['POST', `/tasks/${parent.id}/subtasks`, { instruction: 'child' }],
      ['POST', `/tasks/${parent.id}/comments`, { content: 'hi' }],
      ['POST', `/tasks/${parent.id}/dependencies`, { dependsOnId: parent.id }],
      ['PUT', `/tasks/${parent.id}/checkpoints`, {}],
      ['POST', `/tasks/${parent.id}/archive`, undefined],
    ];

    for (const [method, path, body] of writes) {
      await expectError(
        await call(path, { body, key: KEYS.ownerRead, method }),
        403,
        'insufficient_scope',
      );
    }
  });
});

describe('subtasks', () => {
  it('creates, lists (direct and recursive) and reorders subtasks', async () => {
    const parent = await createTask({ instruction: 'parent' });
    const first = await expectData(
      await call(`/tasks/${parent.identifier}/subtasks`, {
        body: { instruction: 'first' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      201,
      TaskSchema,
    );
    const second = await expectData(
      await call(`/tasks/${parent.id}/subtasks`, {
        body: { instruction: 'second' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      201,
      TaskSchema,
    );
    expect(first.parentTaskId).toBe(parent.id);
    const grandchild = await expectData(
      await call(`/tasks/${first.id}/subtasks`, {
        body: { instruction: 'grandchild' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      201,
      TaskSchema,
    );

    const direct = await expectData(
      await call(`/tasks/${parent.id}/subtasks`, { key: KEYS.ownerRead }),
      200,
      TaskSchema.array(),
    );
    expect(direct.map((task) => task.id)).toEqual([first.id, second.id]);

    const all = await expectData(
      await call(`/tasks/${parent.id}/subtasks?recursive=true`, { key: KEYS.ownerRead }),
      200,
      TaskSchema.array(),
    );
    expect(all.map((task) => task.id).sort()).toEqual([first.id, second.id, grandchild.id].sort());

    const order = await expectData(
      await call(`/tasks/${parent.id}/subtasks/order`, {
        body: { order: [second.identifier, first.identifier] },
        key: KEYS.ownerWrite,
        method: 'PUT',
      }),
      200,
      SubtaskOrderSchema.array(),
    );
    expect(order.map((item) => item.id)).toEqual([second.id, first.id]);
    const reordered = await expectData(
      await call(`/tasks/${parent.id}/subtasks`, { key: KEYS.ownerRead }),
      200,
      TaskSchema.array(),
    );
    expect(reordered.map((task) => task.id)).toEqual([second.id, first.id]);
  });

  it('refuses to order a task that is not a direct subtask', async () => {
    const parent = await createTask({ instruction: 'parent' });
    const unrelated = await createTask({ instruction: 'unrelated' });

    await expectError(
      await call(`/tasks/${parent.id}/subtasks/order`, {
        body: { order: [unrelated.id] },
        key: KEYS.ownerWrite,
        method: 'PUT',
      }),
      400,
    );
  });

  it('rejects a subtask body without an instruction', async () => {
    const parent = await createTask({ instruction: 'parent' });

    await expectError(
      await call(`/tasks/${parent.id}/subtasks`, {
        body: { name: 'no instruction' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      400,
      'validation_error',
    );
  });

  it("answers 404 for another user's task", async () => {
    const parent = await createTask({ instruction: 'parent' });

    await expectError(await call(`/tasks/${parent.id}/subtasks`, { key: KEYS.stranger }), 404);
    await expectError(
      await call(`/tasks/${parent.id}/subtasks`, {
        body: { instruction: 'intrusion' },
        key: KEYS.stranger,
        method: 'POST',
      }),
      404,
    );
  });
});

describe('dependencies', () => {
  it('adds, lists and removes a dependency', async () => {
    const upstream = await createTask({ instruction: 'upstream' });
    const downstream = await createTask({ instruction: 'downstream' });

    const created = await expectData(
      await call(`/tasks/${downstream.id}/dependencies`, {
        body: { dependsOnId: upstream.identifier },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      201,
      TaskDependencySchema,
    );
    expect(created).toMatchObject({
      dependsOnId: upstream.id,
      dependsOnIdentifier: upstream.identifier,
      taskId: downstream.id,
      type: 'blocks',
    });

    const listed = await expectData(
      await call(`/tasks/${downstream.id}/dependencies`, { key: KEYS.ownerRead }),
      200,
      TaskDependencySchema.array(),
    );
    expect(listed).toHaveLength(1);

    const removed = await expectData(
      await call(`/tasks/${downstream.id}/dependencies/${upstream.identifier}`, {
        key: KEYS.ownerWrite,
        method: 'DELETE',
      }),
      200,
      DeletedResourceSchema,
    );
    expect(removed).toEqual({ deleted: true, id: created.id });
    await expectError(
      await call(`/tasks/${downstream.id}/dependencies/${upstream.id}`, {
        key: KEYS.ownerWrite,
        method: 'DELETE',
      }),
      404,
    );
  });

  it('refuses a self-dependency and an unknown type', async () => {
    const task = await createTask({ instruction: 'self' });

    await expectError(
      await call(`/tasks/${task.id}/dependencies`, {
        body: { dependsOnId: task.id },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      400,
    );
    await expectError(
      await call(`/tasks/${task.id}/dependencies`, {
        body: { dependsOnId: task.id, type: 'mirrors' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      400,
      'validation_error',
    );
  });

  it("cannot depend on another user's task", async () => {
    const mine = await createTask({ instruction: 'mine' });
    const theirs = await createTask({ instruction: 'theirs' }, { key: KEYS.stranger });

    await expectError(
      await call(`/tasks/${mine.id}/dependencies`, {
        body: { dependsOnId: theirs.id },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      404,
    );
  });
});

describe('comments', () => {
  it('adds, lists, edits and deletes a comment', async () => {
    const task = await createTask({ instruction: 'discuss' });

    const comment = await expectData(
      await call(`/tasks/${task.id}/comments`, {
        body: { content: 'first note' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      201,
      TaskCommentSchema,
    );
    expect(comment).toMatchObject({ authorUserId: OWNER, content: 'first note', taskId: task.id });

    const listed = await expectData(
      await call(`/tasks/${task.identifier}/comments`, { key: KEYS.ownerRead }),
      200,
      TaskCommentSchema.array(),
    );
    expect(listed.map((item) => item.id)).toEqual([comment.id]);

    const edited = await expectData(
      await call(`/tasks/${task.id}/comments/${comment.id}`, {
        body: { content: 'edited note' },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
      200,
      TaskCommentSchema,
    );
    expect(edited.content).toBe('edited note');

    await expectData(
      await call(`/tasks/${task.id}/comments/${comment.id}`, {
        key: KEYS.ownerWrite,
        method: 'DELETE',
      }),
      200,
      DeletedResourceSchema,
    );
    const after = await expectData(
      await call(`/tasks/${task.id}/comments`, { key: KEYS.ownerRead }),
      200,
      TaskCommentSchema.array(),
    );
    expect(after).toEqual([]);
  });

  it('answers 404 for a comment that belongs to another task', async () => {
    const task = await createTask({ instruction: 'one' });
    const other = await createTask({ instruction: 'two' });
    const comment = await expectData(
      await call(`/tasks/${task.id}/comments`, {
        body: { content: 'on task one' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      201,
      TaskCommentSchema,
    );

    await expectError(
      await call(`/tasks/${other.id}/comments/${comment.id}`, {
        body: { content: 'moved?' },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
      404,
    );
  });

  it("does not let a workspace member edit or delete a colleague's comment", async () => {
    const task = await createTask(
      { instruction: 'shared', visibility: 'public' },
      { key: KEYS.workspaceOwner },
    );
    const comment = await expectData(
      await call(`/tasks/${task.id}/comments`, {
        body: { content: 'owner note' },
        key: KEYS.workspaceOwner,
        method: 'POST',
      }),
      201,
      TaskCommentSchema,
    );

    // The member sees the public task and its comments…
    const listed = await expectData(
      await call(`/tasks/${task.id}/comments`, { key: KEYS.member }),
      200,
      TaskCommentSchema.array(),
    );
    expect(listed).toHaveLength(1);
    // …but cannot change what the owner wrote.
    await expectError(
      await call(`/tasks/${task.id}/comments/${comment.id}`, {
        body: { content: 'rewritten' },
        key: KEYS.member,
        method: 'PATCH',
      }),
      403,
    );
    await expectError(
      await call(`/tasks/${task.id}/comments/${comment.id}`, {
        key: KEYS.member,
        method: 'DELETE',
      }),
      403,
    );
  });

  it('keeps a workspace task out of reach of a personal key', async () => {
    const task = await createTask({ instruction: 'workspace' }, { key: KEYS.workspaceOwner });

    await expectError(await call(`/tasks/${task.id}/comments`, { key: KEYS.ownerWrite }), 404);
  });

  it('rejects an empty comment', async () => {
    const task = await createTask({ instruction: 'discuss' });

    await expectError(
      await call(`/tasks/${task.id}/comments`, {
        body: { content: '' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      400,
      'validation_error',
    );
  });
});

describe('pinned documents', () => {
  it('pins, lists and unpins a document the caller can read', async () => {
    const task = await createTask({ instruction: 'research' });
    await serverDB.insert(documents).values({
      content: 'notes',
      fileType: 'custom/document',
      id: 'docs_r10_mine',
      source: 'api',
      sourceType: 'api',
      title: 'Notes',
      totalCharCount: 5,
      totalLineCount: 1,
      userId: OWNER,
    });

    const pinned = await expectData(
      await call(`/tasks/${task.id}/documents`, {
        body: { documentId: 'docs_r10_mine' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      201,
      TaskPinnedDocumentSchema,
    );
    expect(pinned).toMatchObject({
      documentId: 'docs_r10_mine',
      pinnedBy: 'user',
      taskId: task.id,
    });

    const listed = await expectData(
      await call(`/tasks/${task.id}/documents`, { key: KEYS.ownerRead }),
      200,
      TaskPinnedDocumentSchema.array(),
    );
    expect(listed).toHaveLength(1);

    await expectData(
      await call(`/tasks/${task.id}/documents/docs_r10_mine`, {
        key: KEYS.ownerWrite,
        method: 'DELETE',
      }),
      200,
      DeletedResourceSchema,
    );
    await expectError(
      await call(`/tasks/${task.id}/documents/docs_r10_mine`, {
        key: KEYS.ownerWrite,
        method: 'DELETE',
      }),
      404,
    );
  });

  it("refuses to pin another user's document", async () => {
    const task = await createTask({ instruction: 'research' });
    await serverDB.insert(documents).values({
      content: 'secret',
      fileType: 'custom/document',
      id: 'docs_r10_theirs',
      source: 'api',
      sourceType: 'api',
      title: 'Secret',
      totalCharCount: 6,
      totalLineCount: 1,
      userId: STRANGER,
    });

    await expectError(
      await call(`/tasks/${task.id}/documents`, {
        body: { documentId: 'docs_r10_theirs' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      404,
    );
  });
});

describe('checkpoint, review and verify configuration', () => {
  it('replaces and reads the checkpoint with resolved subtask references', async () => {
    const parent = await createTask({ instruction: 'parent' });
    const child = await expectData(
      await call(`/tasks/${parent.id}/subtasks`, {
        body: { instruction: 'child' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      201,
      TaskSchema,
    );

    const saved = await expectData(
      await call(`/tasks/${parent.id}/checkpoints`, {
        body: { tasks: { afterIds: [child.identifier] }, topic: { after: true } },
        key: KEYS.ownerWrite,
        method: 'PUT',
      }),
      200,
      TaskCheckpointConfigSchema,
    );
    expect(saved.topic).toEqual({ after: true });

    const read = await expectData(
      await call(`/tasks/${parent.id}/checkpoints`, { key: KEYS.ownerRead }),
      200,
      TaskCheckpointSchema,
    );
    expect(read.afterTasks).toEqual([{ id: child.id, identifier: child.identifier }]);
  });

  it('answers null for an unconfigured review, then stores one', async () => {
    const task = await createTask({ instruction: 'judge me' });

    const before = await call(`/tasks/${task.id}/review`, { key: KEYS.ownerRead });
    expect(await expectData(before, 200, TaskReviewConfigSchema.nullable())).toBeNull();

    const saved = await expectData(
      await call(`/tasks/${task.id}/review`, {
        body: {
          enabled: true,
          rubrics: [
            { config: { criteria: 'cites sources' }, id: 'r1', name: 'Sources', type: 'llm' },
          ],
        },
        key: KEYS.ownerWrite,
        method: 'PUT',
      }),
      200,
      TaskReviewConfigSchema,
    );
    expect(saved).toMatchObject({ autoRetry: true, enabled: true, maxIterations: 3 });

    const after = await expectData(
      await call(`/tasks/${task.id}/review`, { key: KEYS.ownerRead }),
      200,
      TaskReviewConfigSchema.nullable(),
    );
    expect(after?.rubrics[0]).toMatchObject({ id: 'r1', weight: 1 });
  });

  it('rejects a review with too many iterations', async () => {
    const task = await createTask({ instruction: 'judge me' });

    await expectError(
      await call(`/tasks/${task.id}/review`, {
        body: { enabled: true, maxIterations: 50, rubrics: [] },
        key: KEYS.ownerWrite,
        method: 'PUT',
      }),
      400,
      'validation_error',
    );
  });

  it('patches and clears verify fields', async () => {
    const task = await createTask({ instruction: 'verify me' });

    const saved = await expectData(
      await call(`/tasks/${task.id}/verify`, {
        body: { enabled: true, maxIterations: 2, requirement: 'Tests pass' },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
      200,
      TaskVerifySchema,
    );
    expect(saved).toEqual({ enabled: true, maxIterations: 2, requirement: 'Tests pass' });

    const cleared = await expectData(
      await call(`/tasks/${task.id}/verify`, {
        body: { maxIterations: null },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
      200,
      TaskVerifySchema,
    );
    expect(cleared).toEqual({ enabled: true, requirement: 'Tests pass' });

    const read = await expectData(
      await call(`/tasks/${task.id}/verify`, { key: KEYS.ownerRead }),
      200,
      TaskVerifySchema.nullable(),
    );
    expect(read).toMatchObject({ enabled: true, requirement: 'Tests pass' });
  });
});

describe('archive', () => {
  it('archives and restores a task', async () => {
    const task = await createTask({ instruction: 'done with it' });

    const archived = await expectData(
      await call(`/tasks/${task.identifier}/archive`, { key: KEYS.ownerWrite, method: 'POST' }),
      200,
      TaskSchema,
    );
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.status).toBe(task.status);

    const restored = await expectData(
      await call(`/tasks/${task.id}/unarchive`, { key: KEYS.ownerWrite, method: 'POST' }),
      200,
      TaskSchema,
    );
    expect(restored.archivedAt).toBeNull();
  });

  it("answers 404 when archiving another user's task", async () => {
    const task = await createTask({ instruction: 'mine' });

    await expectError(
      await call(`/tasks/${task.id}/archive`, { key: KEYS.stranger, method: 'POST' }),
      404,
    );
  });
});
