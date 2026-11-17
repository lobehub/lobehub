// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

/**
 * Goal control endpoints over real HTTP: the real `GoalRoutes` (with the
 * mounted control routes) behind the auth + workspace middlewares `app.ts`
 * mounts, the real scope gates, controllers, REST services, the `goal` tRPC
 * procedures and `GoalService`, on a PGlite database with real `api_keys`
 * rows. Only the advance scheduler is stubbed — it enqueues the coordinator
 * onto a queue that does not exist here — and its calls are asserted. Every
 * success body is parsed with its documented, strict response schema.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));
const scheduler = vi.hoisted(() => ({ scheduleGoalAdvance: vi.fn(async () => {}) }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));
vi.mock('@/server/services/goal/scheduler', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  scheduleGoalAdvance: scheduler.scheduleGoalAdvance,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { aiModels, aiProviders, apiKeys, goals, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { GoalGraphModel } = await import('@/database/models/goalGraph');
const { GoalService } = await import('@/server/services/goal');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const {
  GoalGraphDecisionSchema,
  GoalGraphEdgeSchema,
  GoalGraphNodeSchema,
  GoalGraphSchema,
  GoalGraphSnapshotSchema,
  GoalSchema,
} = await import('../types/goal.type');
const {
  GoalConfigUpdateResultSchema,
  GoalDecisionListSchema,
  GoalEventListSchema,
  GoalMetricStateSchema,
  GoalObservationSchema,
  GoalRemovedEdgesSchema,
  GoalRetiredNodesSchema,
} = await import('../types/goal-advanced.type');
const GoalRoutes = (await import('./goals.route')).default;

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
app.route('/goals', GoalRoutes);

const OWNER = 'r10-goal-owner';
const MEMBER = 'r10-goal-member';
const STRANGER = 'r10-goal-stranger';
const WORKSPACE = 'r10-goal-ws';

/** `sk-lh-` + 16 lowercase alphanumerics — the format the auth middleware checks. */
const KEYS = {
  chatOnly: 'sk-lh-r10goalchatonly1',
  member: 'sk-lh-r10goalmember001',
  ownerRead: 'sk-lh-r10goalownerrd01',
  ownerWrite: 'sk-lh-r10goalownerwr01',
  stranger: 'sk-lh-r10goalstranger1',
  workspaceOwner: 'sk-lh-r10goalwsowner01',
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

const createGoal = async (body: Record<string, unknown> = {}, key: string = KEYS.ownerWrite) =>
  expectData(
    await call('/goals', {
      body: { requirement: 'Ship it', tasks: ['Write', 'Review'], title: 'Launch', ...body },
      key,
      method: 'POST',
    }),
    201,
    GoalGraphSnapshotSchema,
  );

beforeEach(async () => {
  scheduler.scheduleGoalAdvance.mockClear();
  await serverDB.delete(goals);
  await serverDB.delete(aiModels);
  await serverDB.delete(aiProviders);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: MEMBER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: WORKSPACE, name: 'R10 goals', primaryOwnerId: OWNER, slug: 'r10-goals' }]);
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
    await expectError(await call('/goals/goal-x/graph'), 401);
  });

  it('refuses a key without any agent scope on a read', async () => {
    const { goal } = await createGoal();

    await expectError(
      await call(`/goals/${goal.id}/events`, { key: KEYS.chatOnly }),
      403,
      'insufficient_scope',
    );
  });

  it('refuses a read-only key on every kind of write', async () => {
    const { goal } = await createGoal();
    const writes: [string, string, unknown][] = [
      ['PATCH', `/goals/${goal.id}/config`, { requirement: 'x' }],
      ['POST', `/goals/${goal.id}/nodes`, { kind: 'finding', title: 'x' }],
      ['PUT', `/goals/${goal.id}/metrics`, { metrics: [] }],
      ['POST', `/goals/${goal.id}/close`, { status: 'canceled' }],
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

describe('PATCH /goals/:id/config', () => {
  it('updates the requirement and budget together and wakes the coordinator', async () => {
    const { goal } = await createGoal();
    scheduler.scheduleGoalAdvance.mockClear();

    const result = await expectData(
      await call(`/goals/${goal.id}/config`, {
        body: { budget: { maxTotalCost: 12.5 }, requirement: 'Ship it with docs' },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
      200,
      GoalConfigUpdateResultSchema,
    );

    expect(result.graph.goal).toMatchObject({
      maxTotalCost: 12.5,
      requirement: 'Ship it with docs',
    });
    expect(result.reassignedTaskIds).toEqual([]);
    expect(scheduler.scheduleGoalAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: goal.id, trigger: 'budget' }),
    );
  });

  it('applies nothing when one part is refused', async () => {
    const { goal } = await createGoal();

    // A plain goal has no main Agent, so it has no turn budget to set.
    await expectError(
      await call(`/goals/${goal.id}/config`, {
        body: { budget: { maxManagerTurns: 5 }, requirement: 'Should not stick' },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
      400,
    );
    const graph = await expectData(
      await call(`/goals/${goal.id}/graph`, { key: KEYS.ownerRead }),
      200,
      GoalGraphSchema,
    );
    expect(graph.goal.requirement).toBe('Ship it');
  });

  it('refuses a model the owner cannot run and leaves the rest of the patch unapplied', async () => {
    const { goal } = await createGoal();

    await expectError(
      await call(`/goals/${goal.id}/config`, {
        body: { model: { model: 'no-such-model', provider: 'nowhere' }, requirement: 'Nope' },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
      400,
    );
    const graph = await expectData(
      await call(`/goals/${goal.id}/graph`, { key: KEYS.ownerRead }),
      200,
      GoalGraphSchema,
    );
    expect(graph.goal.requirement).toBe('Ship it');
  });

  it('switches the planning model and clears it again', async () => {
    const { goal } = await createGoal();
    // A custom provider with one enabled model: the owner's picker offers it.
    await serverDB
      .insert(aiProviders)
      .values({ enabled: true, id: 'r10-provider', name: 'R10', source: 'custom', userId: OWNER });
    await serverDB.insert(aiModels).values({
      enabled: true,
      id: 'r10-model',
      providerId: 'r10-provider',
      source: 'custom',
      type: 'chat',
      userId: OWNER,
    });

    const set = await expectData(
      await call(`/goals/${goal.id}/config`, {
        body: { model: { model: 'r10-model', provider: 'r10-provider' } },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
      200,
      GoalConfigUpdateResultSchema,
    );
    expect(set.graph.goal.config).toMatchObject({ model: 'r10-model', provider: 'r10-provider' });

    const cleared = await expectData(
      await call(`/goals/${goal.id}/config`, {
        body: { model: null },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
      200,
      GoalConfigUpdateResultSchema,
    );
    expect(cleared.graph.goal.config?.model).toBeUndefined();
    expect(cleared.graph.goal.config?.provider).toBeUndefined();
  });

  it('rejects an empty patch and unknown fields', async () => {
    const { goal } = await createGoal();

    await expectError(
      await call(`/goals/${goal.id}/config`, { body: {}, key: KEYS.ownerWrite, method: 'PATCH' }),
      400,
      'validation_error',
    );
    await expectError(
      await call(`/goals/${goal.id}/config`, {
        body: { budget: { maxRuns: 3 } },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
      400,
      'validation_error',
    );
  });

  it("answers 404 for another user's goal", async () => {
    const { goal } = await createGoal();

    await expectError(
      await call(`/goals/${goal.id}/config`, {
        body: { requirement: 'hijack' },
        key: KEYS.stranger,
        method: 'PATCH',
      }),
      404,
    );
  });

  it("keeps a workspace member from re-pointing a colleague's goal", async () => {
    const { goal } = await createGoal({}, KEYS.workspaceOwner);

    await expectError(
      await call(`/goals/${goal.id}/config`, {
        body: { model: { model: 'gpt-5', provider: 'openai' } },
        key: KEYS.member,
        method: 'PATCH',
      }),
      403,
    );
    // A personal key does not reach into the workspace at all.
    await expectError(await call(`/goals/${goal.id}/graph`, { key: KEYS.ownerRead }), 404);
  });
});

describe('graph edits', () => {
  it('reads the graph, adds nodes and edges, and retires a task node', async () => {
    const { goal } = await createGoal();

    const graph = await expectData(
      await call(`/goals/${goal.id}/graph?capabilities=batch,marks`, { key: KEYS.ownerRead }),
      200,
      GoalGraphSchema,
    );
    const taskNodes = graph.nodes.filter((node) => node.kind === 'task');
    expect(taskNodes.map((node) => node.title).sort()).toEqual(['Review', 'Write']);

    const finding = await expectData(
      await call(`/goals/${goal.id}/nodes`, {
        body: { kind: 'finding', title: 'Docs are thin' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      201,
      GoalGraphNodeSchema,
    );
    expect(finding).toMatchObject({ goalId: goal.id, kind: 'finding', title: 'Docs are thin' });

    const edge = await expectData(
      await call(`/goals/${goal.id}/edges`, {
        body: { kind: 'supports', sourceNodeId: finding.id, targetNodeId: taskNodes[0].id },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      201,
      GoalGraphEdgeSchema,
    );
    expect(edge).toMatchObject({ kind: 'supports', sourceNodeId: finding.id });

    // The goal is running, so removing an edge is refused.
    await expectError(
      await call(
        `/goals/${goal.id}/edges?sourceNodeId=${finding.id}&targetNodeId=${taskNodes[0].id}`,
        { key: KEYS.ownerWrite, method: 'DELETE' },
      ),
      412,
    );

    const retired = await expectData(
      await call(`/goals/${goal.id}/nodes/retire`, {
        body: { nodeIds: taskNodes.map((node) => node.id), reason: 'done elsewhere' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      200,
      GoalRetiredNodesSchema,
    );
    expect(retired.retiredNodeIds.sort()).toEqual(taskNodes.map((node) => node.id).sort());
  });

  it('removes an edge from a draft goal', async () => {
    const draft = await new GoalService(serverDB, OWNER).create({
      draft: true,
      requirement: 'Draft',
      tasks: ['First', 'Second'],
      title: 'Draft goal',
    });
    const [first, second] = draft.nodes.filter((node) => node.kind === 'task');
    await expectData(
      await call(`/goals/${draft.goal.id}/edges`, {
        body: { kind: 'depends_on', sourceNodeId: second.id, targetNodeId: first.id },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      201,
      GoalGraphEdgeSchema,
    );

    const removed = await expectData(
      await call(
        `/goals/${draft.goal.id}/edges?sourceNodeId=${second.id}&targetNodeId=${first.id}&kind=depends_on`,
        { key: KEYS.ownerWrite, method: 'DELETE' },
      ),
      200,
      GoalRemovedEdgesSchema,
    );
    expect(removed.edgeIds).toHaveLength(1);
  });

  it('rejects an internal edge kind and a malformed node id', async () => {
    const { goal, nodes } = await createGoal();
    const [node] = nodes;

    await expectError(
      await call(`/goals/${goal.id}/edges`, {
        body: { kind: 'revises', sourceNodeId: node.id, targetNodeId: node.id },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      400,
      'validation_error',
    );
    await expectError(
      await call(`/goals/${goal.id}/edges`, {
        body: { kind: 'supports', sourceNodeId: 'not-a-uuid', targetNodeId: node.id },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      400,
      'validation_error',
    );
  });

  it("does not add nodes to another user's goal", async () => {
    const { goal } = await createGoal();

    await expectError(
      await call(`/goals/${goal.id}/nodes`, {
        body: { kind: 'finding', title: 'intrusion' },
        key: KEYS.stranger,
        method: 'POST',
      }),
      404,
    );
  });
});

describe('events', () => {
  it('pages the audit trail by cursor', async () => {
    const { goal } = await createGoal();

    const first = await expectData(
      await call(`/goals/${goal.id}/events?limit=2`, { key: KEYS.ownerRead }),
      200,
      GoalEventListSchema,
    );
    expect(first.events).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const second = await expectData(
      await call(
        `/goals/${goal.id}/events?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
        {
          key: KEYS.ownerRead,
        },
      ),
      200,
      GoalEventListSchema,
    );
    expect(second.events[0].id).not.toBe(first.events[0].id);

    const nodesOnly = await expectData(
      await call(`/goals/${goal.id}/events?entityType=node`, { key: KEYS.ownerRead }),
      200,
      GoalEventListSchema,
    );
    expect(nodesOnly.events.every((event) => event.entityType === 'node')).toBe(true);
  });

  it('rejects a cursor it did not issue and an oversized page', async () => {
    const { goal } = await createGoal();

    await expectError(
      await call(`/goals/${goal.id}/events?cursor=bogus`, { key: KEYS.ownerRead }),
      400,
    );
    await expectError(
      await call(`/goals/${goal.id}/events?limit=500`, { key: KEYS.ownerRead }),
      400,
      'validation_error',
    );
  });
});

describe('decisions and clarifications', () => {
  const openDecision = async (goalId: string) => {
    const node = await expectData(
      await call(`/goals/${goalId}/nodes`, {
        body: { kind: 'decision', title: 'Which channel?' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      201,
      GoalGraphNodeSchema,
    );
    const decision = await new GoalGraphModel(serverDB, OWNER).createDecision(goalId, node.id, {
      authority: 'user',
      options: [
        { id: 'blog', label: 'Blog' },
        { id: 'video', label: 'Video' },
      ],
      question: 'Which channel?',
    });
    return decision!;
  };

  it('lists pending decisions and answers one', async () => {
    const { goal } = await createGoal();
    const decision = await openDecision(goal.id);
    scheduler.scheduleGoalAdvance.mockClear();

    const pending = await expectData(
      await call(`/goals/${goal.id}/decisions?status=pending`, { key: KEYS.ownerRead }),
      200,
      GoalDecisionListSchema,
    );
    expect(pending.map((item) => item.id)).toEqual([decision.id]);

    const resolved = await expectData(
      await call(`/goals/${goal.id}/decisions/${decision.id}`, {
        body: { optionId: 'blog', resolution: 'Cheaper' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      200,
      GoalGraphDecisionSchema,
    );
    expect(resolved).toMatchObject({ resolvedOptionId: 'blog', status: 'resolved' });
    expect(scheduler.scheduleGoalAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: goal.id, trigger: 'decide' }),
    );

    const stillPending = await expectData(
      await call(`/goals/${goal.id}/decisions?status=pending`, { key: KEYS.ownerRead }),
      200,
      GoalDecisionListSchema,
    );
    expect(stillPending).toEqual([]);
  });

  it('answers clarifications as one round', async () => {
    const { goal } = await createGoal();
    const decision = await openDecision(goal.id);

    const graph = await expectData(
      await call(`/goals/${goal.id}/clarifications`, {
        body: { answers: [{ decisionId: decision.id, optionId: 'video' }] },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      200,
      GoalGraphSchema,
    );
    expect(graph.decisions.find((item) => item.id === decision.id)?.status).toBe('resolved');
  });

  it('rejects a decision id that is not a uuid and an empty round', async () => {
    const { goal } = await createGoal();

    await expectError(
      await call(`/goals/${goal.id}/decisions/not-a-uuid`, {
        body: { optionId: 'blog' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      400,
      'validation_error',
    );
    await expectError(
      await call(`/goals/${goal.id}/clarifications`, {
        body: { answers: [] },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      400,
      'validation_error',
    );
  });

  it("does not list another user's decisions", async () => {
    const { goal } = await createGoal();

    await expectError(await call(`/goals/${goal.id}/decisions`, { key: KEYS.stranger }), 404);
  });
});

describe('measured acceptance', () => {
  it('declares a clause, records a measurement that meets it, then removes it', async () => {
    const { goal } = await createGoal();

    const declared = await expectData(
      await call(`/goals/${goal.id}/metrics`, {
        body: { metrics: [{ key: 'signups', op: 'gte', target: 100, title: 'Signups' }] },
        key: KEYS.ownerWrite,
        method: 'PUT',
      }),
      200,
      GoalGraphSchema,
    );
    expect(declared.metricCriteria.criteria.map((item) => item.key)).toEqual(['signups']);

    const before = await expectData(
      await call(`/goals/${goal.id}/metrics`, { key: KEYS.ownerRead }),
      200,
      GoalMetricStateSchema,
    );
    expect(before).toMatchObject({ allMet: false });
    expect(before.criteria[0]).toMatchObject({ key: 'signups', title: 'Signups', value: null });

    const observation = await expectData(
      await call(`/goals/${goal.id}/metrics/observations`, {
        body: { key: 'signups', value: 120 },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      201,
      GoalObservationSchema,
    );
    expect(observation).toMatchObject({ key: 'signups', value: 120 });

    const after = await expectData(
      await call(`/goals/${goal.id}/metrics`, { key: KEYS.ownerRead }),
      200,
      GoalMetricStateSchema,
    );
    expect(after.allMet).toBe(true);
    expect(after.criteria[0]).toMatchObject({ met: true, value: 120 });

    const removed = await expectData(
      await call(`/goals/${goal.id}/metrics?keys=signups`, {
        key: KEYS.ownerWrite,
        method: 'DELETE',
      }),
      200,
      GoalGraphSchema,
    );
    expect(removed.metricCriteria.criteria).toEqual([]);
  });

  it('rejects a clause without a target and a non-numeric value', async () => {
    const { goal } = await createGoal();

    await expectError(
      await call(`/goals/${goal.id}/metrics`, {
        body: { metrics: [{ key: 'signups' }] },
        key: KEYS.ownerWrite,
        method: 'PUT',
      }),
      400,
      'validation_error',
    );
    await expectError(
      await call(`/goals/${goal.id}/metrics/observations`, {
        body: { key: 'signups', value: 'many' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      400,
      'validation_error',
    );
  });

  it("does not record against another user's goal", async () => {
    const { goal } = await createGoal();

    await expectError(
      await call(`/goals/${goal.id}/metrics/observations`, {
        body: { key: 'signups', value: 1 },
        key: KEYS.stranger,
        method: 'POST',
      }),
      404,
    );
  });
});

describe('POST /goals/:id/close', () => {
  it('ends the goal as canceled', async () => {
    const { goal } = await createGoal();

    const closed = await expectData(
      await call(`/goals/${goal.id}/close`, {
        body: { status: 'canceled' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      200,
      GoalSchema,
    );
    expect(closed.status).toBe('canceled');
  });

  it('rejects a status other than achieved or canceled', async () => {
    const { goal } = await createGoal();

    await expectError(
      await call(`/goals/${goal.id}/close`, {
        body: { status: 'paused' },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      400,
      'validation_error',
    );
  });

  it("keeps a workspace member from closing a colleague's goal", async () => {
    const { goal } = await createGoal({}, KEYS.workspaceOwner);

    await expectError(
      await call(`/goals/${goal.id}/close`, {
        body: { status: 'canceled' },
        key: KEYS.member,
        method: 'POST',
      }),
      403,
    );
  });

  it("answers 404 for another user's goal", async () => {
    const { goal } = await createGoal();

    await expectError(
      await call(`/goals/${goal.id}/close`, {
        body: { status: 'achieved' },
        key: KEYS.stranger,
        method: 'POST',
      }),
      404,
    );
  });
});
