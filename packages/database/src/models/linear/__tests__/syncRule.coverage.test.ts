// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { projects, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { LinearConnectionModel } from '../connection';
import { LinearSyncRuleModel } from '../syncRule';

const db: LobeChatDatabase = await getTestDB();

const userId = 'linear-rule-cov-user';
const otherUserId = 'linear-rule-cov-other';
const workspaceId = 'linear-rule-cov-ws';
const projectId = 'linear-rule-cov-project';
const wsProjectId = 'linear-rule-cov-ws-project';

const personal = { userId };
const shared = { userId, workspaceId };

const result = {
  closed: 0,
  created: 2,
  keptLocalEdits: 0,
  skipped: [],
  truncated: false,
  unchanged: 1,
  updated: 0,
};

let connectionId: string;

const rule = (overrides: Partial<Parameters<typeof LinearSyncRuleModel.create>[1]> = {}) =>
  LinearSyncRuleModel.create(db, {
    connectionId,
    projectId,
    stateTypes: ['backlog', 'started'],
    teamId: 'team-cov',
    teamName: 'Engineering',
    userId,
    ...overrides,
  });

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
  await db.insert(projects).values([
    { id: projectId, name: 'Personal', userId },
    { id: wsProjectId, name: 'Shared', userId, workspaceId },
  ]);
  const connection = await LinearConnectionModel.upsert(db, {
    actorExternalId: 'linear-rule-cov-actor',
    actorName: 'Ada',
    credentials: { accessToken: 'token' },
    organizationId: 'linear-rule-cov-org',
    organizationName: 'Acme',
    organizationUrlKey: 'acme-rule-cov',
    userId,
  });
  connectionId = connection.id;
});

afterEach(async () => {
  // Projects, connections and rules cascade with their owner and workspace.
  await db.delete(workspaces).where(inArray(workspaces.id, [workspaceId]));
  await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('LinearSyncRuleModel coverage', () => {
  it('lists a project rules newest first, per scope', async () => {
    const older = await rule({ createdAt: new Date('2026-01-01T00:00:00.000Z') });
    const newer = await rule({ createdAt: new Date('2026-01-02T00:00:00.000Z') });
    const wsRule = await rule({ projectId: wsProjectId, workspaceId });

    expect(
      (await LinearSyncRuleModel.listByProject(db, personal, projectId)).map((r) => r.id),
    ).toEqual([newer.id, older.id]);
    expect(
      (await LinearSyncRuleModel.listByProject(db, shared, wsProjectId)).map((r) => r.id),
    ).toEqual([wsRule.id]);
    // A workspace scope never lists personal rules, and another user sees none.
    expect(await LinearSyncRuleModel.listByProject(db, shared, projectId)).toEqual([]);
    expect(await LinearSyncRuleModel.listByProject(db, { userId: otherUserId }, projectId)).toEqual(
      [],
    );
  });

  it('finds and locks a rule only inside its scope', async () => {
    const created = await rule();
    const missingId = '00000000-0000-4000-8000-000000000000';

    expect(await LinearSyncRuleModel.findInScope(db, created.id, personal)).toMatchObject({
      id: created.id,
    });
    expect(await LinearSyncRuleModel.findInScope(db, created.id, shared)).toBeNull();
    expect(await LinearSyncRuleModel.findInScope(db, missingId, personal)).toBeNull();

    const locked = await db.transaction((trx) =>
      LinearSyncRuleModel.lockInScope(trx as unknown as LobeChatDatabase, created.id, personal),
    );
    expect(locked).toBe(true);
    expect(
      await db.transaction((trx) =>
        LinearSyncRuleModel.lockInScope(trx as unknown as LobeChatDatabase, created.id, {
          userId: otherUserId,
        }),
      ),
    ).toBe(false);
  });

  it('records a run and exposes it through the view', async () => {
    const created = await rule({ linearProjectId: 'lp-1', linearProjectName: 'Roadmap' });

    expect(LinearSyncRuleModel.toView(created)).toMatchObject({
      lastResult: null,
      lastRunAt: null,
      linearProjectId: 'lp-1',
      linearProjectName: 'Roadmap',
    });

    // Another scope cannot record a run on this rule.
    await LinearSyncRuleModel.recordRun(db, created.id, { userId: otherUserId }, result);
    expect((await LinearSyncRuleModel.findInScope(db, created.id, personal))?.lastRunAt).toBeNull();

    await LinearSyncRuleModel.recordRun(db, created.id, personal, result);
    const row = await LinearSyncRuleModel.findInScope(db, created.id, personal);
    const view = LinearSyncRuleModel.toView(row!);

    expect(view).toEqual({
      connectionId,
      createdAt: row!.createdAt,
      id: created.id,
      lastResult: result,
      lastRunAt: expect.any(Date),
      linearProjectId: 'lp-1',
      linearProjectName: 'Roadmap',
      projectId,
      stateTypes: ['backlog', 'started'],
      teamId: 'team-cov',
      teamName: 'Engineering',
    });
  });

  it('deletes a rule only from its own scope', async () => {
    const created = await rule();

    await LinearSyncRuleModel.delete(db, created.id, shared);
    expect(await LinearSyncRuleModel.findInScope(db, created.id, personal)).not.toBeNull();

    await LinearSyncRuleModel.delete(db, created.id, personal);
    expect(await LinearSyncRuleModel.findInScope(db, created.id, personal)).toBeNull();
  });
});
