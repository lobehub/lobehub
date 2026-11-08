// @vitest-environment node
import type { LinearSyncResult } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { linearConnections, linearSyncRules, projects, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { LinearConnectionModel } from '../connection';
import { LinearSyncRuleModel } from '../syncRule';

const db: LobeChatDatabase = await getTestDB();

const userId = 'linear-rule-user';
const otherUserId = 'linear-rule-other';
const workspaceId = 'linear-rule-ws';
const projectId = 'linear-rule-project';
const otherProjectId = 'linear-rule-project-2';

let connectionId: string;

const result: LinearSyncResult = {
  closed: 1,
  created: 3,
  keptLocalEdits: 0,
  skipped: [{ identifier: 'ACE-9', reason: 'completed' }],
  truncated: false,
  unchanged: 2,
};

interface SeedRuleParams {
  createdAt?: Date;
  projectId?: string;
  teamId?: string;
  userId?: string;
  workspaceId?: string | null;
}

const seedRule = async (params: SeedRuleParams = {}) => {
  const [row] = await db
    .insert(linearSyncRules)
    .values({
      connectionId,
      projectId: params.projectId ?? projectId,
      stateTypes: ['started'],
      teamId: params.teamId ?? 'team-1',
      teamName: 'Platform',
      userId: params.userId ?? userId,
      workspaceId: params.workspaceId ?? null,
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    })
    .returning();

  return row;
};

const personalScope = { userId };
const workspaceScope = { userId, workspaceId };

beforeEach(async () => {
  await db.delete(linearSyncRules);
  await db.delete(linearConnections);
  await db.delete(projects);
  await db.delete(users);

  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
  await db.insert(projects).values([
    { id: projectId, name: 'Rule project', userId },
    { id: otherProjectId, name: 'Other project', userId },
  ]);

  const connection = await LinearConnectionModel.upsert(db, {
    actorExternalId: 'linear-actor',
    actorName: 'Ada',
    credentials: { accessToken: 'token' },
    organizationId: 'org-rule',
    organizationName: 'Acme',
    organizationUrlKey: 'acme-rule',
    userId,
  });
  connectionId = connection.id;
});

afterEach(async () => {
  await db.delete(linearSyncRules);
  await db.delete(linearConnections);
  await db.delete(projects);
  await db.delete(users);
});

describe('LinearSyncRuleModel', () => {
  describe('listByProject', () => {
    it('lists the personal rules of one project newest first', async () => {
      const older = await seedRule({ createdAt: new Date('2026-01-01T00:00:00Z') });
      const newer = await seedRule({
        createdAt: new Date('2026-02-01T00:00:00Z'),
        teamId: 'team-2',
      });
      await seedRule({ projectId: otherProjectId });
      await seedRule({ userId: otherUserId });

      const rows = await LinearSyncRuleModel.listByProject(db, personalScope, projectId);

      expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);
    });

    it('leaves workspace rules out of the personal scope and vice versa', async () => {
      const personal = await seedRule();
      const workspace = await seedRule({ workspaceId });

      const personalRows = await LinearSyncRuleModel.listByProject(db, personalScope, projectId);
      const workspaceRows = await LinearSyncRuleModel.listByProject(db, workspaceScope, projectId);

      expect(personalRows.map((row) => row.id)).toEqual([personal.id]);
      expect(workspaceRows.map((row) => row.id)).toEqual([workspace.id]);
    });
  });

  describe('findInScope', () => {
    it('returns the row only inside its own scope', async () => {
      const personal = await seedRule();
      const workspace = await seedRule({ workspaceId });

      expect(await LinearSyncRuleModel.findInScope(db, personal.id, personalScope)).toMatchObject({
        id: personal.id,
      });
      expect(await LinearSyncRuleModel.findInScope(db, personal.id, workspaceScope)).toBeNull();
      expect(await LinearSyncRuleModel.findInScope(db, workspace.id, workspaceScope)).toMatchObject(
        { id: workspace.id },
      );
      expect(await LinearSyncRuleModel.findInScope(db, workspace.id, personalScope)).toBeNull();
    });

    it('returns null for another user and for an id that does not exist', async () => {
      const rule = await seedRule();

      expect(
        await LinearSyncRuleModel.findInScope(db, rule.id, { userId: otherUserId }),
      ).toBeNull();
      expect(
        await LinearSyncRuleModel.findInScope(db, '00000000-0000-0000-0000-000000000000', {
          userId,
        }),
      ).toBeNull();
    });
  });

  describe('lockInScope', () => {
    it('locks the row for the owning scope only', async () => {
      const rule = await seedRule();

      expect(await LinearSyncRuleModel.lockInScope(db, rule.id, personalScope)).toBe(true);
      expect(await LinearSyncRuleModel.lockInScope(db, rule.id, { userId: otherUserId })).toBe(
        false,
      );
      expect(
        await LinearSyncRuleModel.lockInScope(db, '00000000-0000-0000-0000-000000000000', {
          userId,
        }),
      ).toBe(false);
    });
  });

  describe('create', () => {
    it('stores the rule with an empty run history', async () => {
      const row = await LinearSyncRuleModel.create(db, {
        connectionId,
        linearProjectId: 'linear-project-1',
        linearProjectName: 'Q3 roadmap',
        projectId,
        stateTypes: ['started', 'unstarted'],
        teamId: 'team-9',
        teamName: 'Runtime',
        userId,
        workspaceId: null,
      });

      expect(row).toMatchObject({
        lastResult: null,
        lastRunAt: null,
        linearProjectName: 'Q3 roadmap',
        stateTypes: ['started', 'unstarted'],
        teamName: 'Runtime',
        workspaceId: null,
      });
    });
  });

  describe('delete', () => {
    it('deletes only the rule that belongs to the scope', async () => {
      const own = await seedRule();
      const foreign = await seedRule({ userId: otherUserId });

      await LinearSyncRuleModel.delete(db, foreign.id, personalScope);
      await LinearSyncRuleModel.delete(db, own.id, personalScope);

      const remaining = await db.select().from(linearSyncRules);
      expect(remaining.map((row) => row.id)).toEqual([foreign.id]);
    });
  });

  describe('recordRun', () => {
    it('writes the last result and run time', async () => {
      const rule = await seedRule();

      await LinearSyncRuleModel.recordRun(db, rule.id, personalScope, result);

      const [updated] = await db.select().from(linearSyncRules);
      expect(updated.lastResult).toEqual(result);
      expect(updated.lastRunAt).toBeInstanceOf(Date);
    });

    it('does not touch a rule outside the scope', async () => {
      const foreign = await seedRule({ userId: otherUserId });

      await LinearSyncRuleModel.recordRun(db, foreign.id, personalScope, result);

      const [untouched] = await db.select().from(linearSyncRules);
      expect(untouched.lastResult).toBeNull();
      expect(untouched.lastRunAt).toBeNull();
    });
  });

  describe('toView', () => {
    it('maps a never-run rule, keeping the null result', async () => {
      const row = await seedRule();

      expect(LinearSyncRuleModel.toView(row)).toMatchObject({
        connectionId,
        lastResult: null,
        lastRunAt: null,
        linearProjectId: null,
        linearProjectName: null,
        projectId,
        stateTypes: ['started'],
        teamId: 'team-1',
        teamName: 'Platform',
      });
      expect(LinearSyncRuleModel.toView(row).createdAt).toEqual(row.createdAt);
    });

    it('passes the last result through once the rule has run', async () => {
      const row = await seedRule();
      await LinearSyncRuleModel.recordRun(db, row.id, personalScope, result);

      const [updated] = await db.select().from(linearSyncRules);

      expect(LinearSyncRuleModel.toView(updated).lastResult).toEqual(result);
      expect(LinearSyncRuleModel.toView(updated).lastRunAt).toBeInstanceOf(Date);
    });
  });
});
