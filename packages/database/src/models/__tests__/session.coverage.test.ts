// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, agentsToSessions, sessions, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SessionModel } from '../session';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'session-coverage-user';
const otherUserId = 'session-coverage-other';
const sessionModel = new SessionModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  // Sessions, agents and their links cascade from the owning user.
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

const findSession = (id: string) =>
  serverDB.query.sessions.findFirst({ where: eq(sessions.id, id) });

const findAgent = (id: string) => serverDB.query.agents.findFirst({ where: eq(agents.id, id) });

describe('SessionModel coverage', () => {
  describe('query', () => {
    it('folds every linked agent of a group shell into one session entry', async () => {
      await serverDB.insert(sessions).values({ id: 'sc-group', type: 'group', userId });
      await serverDB.insert(agents).values([
        { id: 'sc-member-a', userId },
        { id: 'sc-member-b', userId },
      ]);
      await serverDB.insert(agentsToSessions).values([
        { agentId: 'sc-member-a', sessionId: 'sc-group', userId },
        { agentId: 'sc-member-b', sessionId: 'sc-group', userId },
      ]);

      const result = await sessionModel.query();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('sc-group');
      expect(
        result[0].agentsToSessions.map((link: { agent: { id: string } }) => link.agent.id).sort(),
      ).toEqual(['sc-member-a', 'sc-member-b']);
    });
  });

  describe('create', () => {
    it('stores a null model when the config carries no model string', async () => {
      const session = await sessionModel.create({ config: { title: 'No model' }, type: 'agent' });

      const [link] = await serverDB
        .select()
        .from(agentsToSessions)
        .where(eq(agentsToSessions.sessionId, session.id));
      expect(await findAgent(link.agentId)).toMatchObject({ model: null, title: 'No model' });
    });
  });

  describe('batchDelete', () => {
    it('returns an empty result for no ids', async () => {
      expect(await sessionModel.batchDelete([])).toEqual({
        orphanedAgentIds: [],
        result: { count: 0 },
      });
    });

    it("returns an empty result and deletes nothing when no id is the user's", async () => {
      await serverDB.insert(sessions).values({ id: 'sc-foreign', userId: otherUserId });

      expect(await sessionModel.batchDelete(['sc-foreign', 'sc-missing'])).toEqual({
        orphanedAgentIds: [],
        result: { count: 0 },
      });
      expect(await findSession('sc-foreign')).toBeDefined();
    });
  });

  describe('deleteAll', () => {
    it('returns a zero count when the user has no sessions', async () => {
      await serverDB.insert(sessions).values({ id: 'sc-foreign', userId: otherUserId });

      expect(await sessionModel.deleteAll()).toEqual({ count: 0 });
      expect(await findSession('sc-foreign')).toBeDefined();
    });
  });

  describe('clearOrphanAgent via delete', () => {
    it('keeps an agent that is still linked to another session', async () => {
      await serverDB.insert(sessions).values([
        { id: 'sc-first', userId },
        { id: 'sc-second', userId },
      ]);
      await serverDB.insert(agents).values({ id: 'sc-shared-agent', userId });
      await serverDB.insert(agentsToSessions).values([
        { agentId: 'sc-shared-agent', sessionId: 'sc-first', userId },
        { agentId: 'sc-shared-agent', sessionId: 'sc-second', userId },
      ]);

      const { orphanedAgentIds } = await sessionModel.delete('sc-first');

      expect(orphanedAgentIds).toEqual([]);
      expect(await findSession('sc-first')).toBeUndefined();
      expect(await findAgent('sc-shared-agent')).toBeDefined();
    });
  });

  describe('deleteShellsByIds', () => {
    it('does nothing for no ids', async () => {
      await serverDB.insert(sessions).values({ id: 'sc-shell', userId });

      await sessionModel.deleteShellsByIds([]);

      expect(await findSession('sc-shell')).toBeDefined();
    });

    it("drops only the user's own shells", async () => {
      await serverDB.insert(sessions).values([
        { id: 'sc-shell', userId },
        { id: 'sc-foreign', userId: otherUserId },
      ]);

      await sessionModel.deleteShellsByIds(['sc-shell', 'sc-foreign']);

      expect(await findSession('sc-shell')).toBeUndefined();
      expect(await findSession('sc-foreign')).toBeDefined();
    });
  });
});
