// @vitest-environment node
import { INBOX_SESSION_ID } from '@lobechat/const';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, projects, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';
import { ProjectModel } from '../project';
import { TaskModel } from '../task';
import { createProxyTestDB } from './_proxyTestDB';

const userId = 't863-proj-user';
const otherUserId = 't863-proj-other';

const serverDB: LobeChatDatabase = await getTestDB();

const model = new ProjectModel(serverDB, userId);

/** Runs `db.transaction` callbacks on a proxy that forwards to the real test database. */
const runTransactionsOn = (proxy: LobeChatDatabase) =>
  vi
    .spyOn(serverDB, 'transaction')
    .mockImplementation(((callback: (tx: LobeChatDatabase) => unknown) =>
      callback(proxy)) as unknown as typeof serverDB.transaction);

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Projects, agents, project members and tasks cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('ProjectModel coverage', () => {
  describe('delete', () => {
    it('returns null when the row is gone by the time the delete runs', async () => {
      await serverDB.insert(projects).values({ id: 't863-proj-race', name: 'Race', userId });

      // A concurrent delete wins between the visibility read and our delete: ours returns no row.
      runTransactionsOn(
        createProxyTestDB(serverDB, (query, result) =>
          query.startsWith('delete from "projects"') ? [] : result.rows,
        ),
      );

      expect(await model.delete('t863-proj-race')).toBeNull();
    });
  });

  describe('resolveCoordinatorAgents', () => {
    it('returns the items untouched when every project has a main agent', async () => {
      const items = [{ coordinatorAgentId: 'a' }, { coordinatorAgentId: 'b' }];

      expect(await model.resolveCoordinatorAgents(items)).toBe(items);
    });

    it('throws when the LobeAI fallback cannot be resolved', async () => {
      // LobeAI exists, so the idempotent insert is a no-op; both reads then miss (row vanished).
      await new AgentModel(serverDB, userId).getBuiltinAgent(INBOX_SESSION_ID);
      vi.spyOn(serverDB.query.agents, 'findFirst').mockResolvedValue(undefined);

      await expect(model.resolveCoordinatorAgents([{ coordinatorAgentId: null }])).rejects.toThrow(
        'Project main agent not found',
      );
    });
  });

  describe('move', () => {
    it('is a no-op when a project is anchored to itself', async () => {
      await serverDB
        .insert(projects)
        .values({ id: 't863-proj-self', name: 'Self', sortOrder: 7, userId });

      expect(await model.move('t863-proj-self', { afterId: 't863-proj-self' })).toBeUndefined();

      const [row] = await serverDB.select().from(projects).where(eq(projects.id, 't863-proj-self'));
      expect(row.sortOrder).toBe(7);
    });

    it('throws when the anchor disappears between the visibility check and the ordered read', async () => {
      await serverDB.insert(projects).values([
        { id: 't863-proj-a', name: 'A', userId },
        { id: 't863-proj-b', name: 'B', userId },
      ]);

      runTransactionsOn(
        createProxyTestDB(serverDB, (query, result) =>
          query.includes('NULLS FIRST')
            ? result.rows.filter((row) => row[0] !== 't863-proj-b')
            : result.rows,
        ),
      );

      await expect(model.move('t863-proj-a', { beforeId: 't863-proj-b' })).rejects.toThrow(
        'Project not found',
      );
      const rows = await serverDB
        .select({ sortOrder: projects.sortOrder })
        .from(projects)
        .where(inArray(projects.id, ['t863-proj-a', 't863-proj-b']));
      expect(rows.map((row) => row.sortOrder)).toEqual([null, null]);
    });
  });

  describe('missing project guards', () => {
    it('returns null / empty results for a project the caller cannot see', async () => {
      await serverDB
        .insert(projects)
        .values({ id: 't863-proj-foreign', name: 'Foreign', userId: otherUserId });

      expect(await model.updateAgent('t863-proj-foreign', 'agent', { enabled: false })).toBeNull();
      expect(
        await model.updateKnowledgeBase('t863-proj-foreign', 'kb', { enabled: false }),
      ).toBeNull();
      expect(await model.getEnabledKnowledgeBaseIds('t863-proj-foreign')).toEqual([]);
      expect(await model.getEnabledKnowledgeBaseIds('t863-proj-missing')).toEqual([]);
    });
  });

  describe('assignCoordinator', () => {
    it('keeps the project as is when the agent already leads it', async () => {
      const project = await model.create({ name: 'Led' });

      const result = await model.assignCoordinator(project.id, project.coordinatorAgentId!);

      expect(result).toEqual({
        previousId: null,
        project: expect.objectContaining({
          coordinatorAgentId: project.coordinatorAgentId,
          id: project.id,
        }),
      });
      const [lead] = await serverDB
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.id, project.coordinatorAgentId!));
      expect(lead).toBeDefined();
    });
  });

  describe('listTasks', () => {
    it("lists a visible project's tasks", async () => {
      const project = await model.create({ name: 'With tasks' });
      const task = await new TaskModel(serverDB, userId).create({
        instruction: 'Ship it',
        projectId: project.id,
      });

      const rows = await model.listTasks(project.id);

      expect(rows?.map((row) => row.id)).toEqual([task.id]);
    });
  });
});
