// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, userConnectors, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ConnectorModel } from '../connector';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'conncov-user';
const agentId = 'conncov-agent';
const missingId = '00000000-0000-4000-8000-000000000000';

const composio = {
  appSlug: 'gmail',
  authConfigId: 'auth-1',
  connectedAccountId: 'ca-1',
  status: 'ACTIVE',
};

const cleanup = async () => {
  // agents and user_connectors cascade from the owning user.
  await serverDB.delete(users).where(eq(users.id, userId));
};

const base = { name: 'Connector', sourceType: 'builtin', status: 'connected' } as const;

describe('ConnectorModel coverage edges', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(agents).values({ id: agentId, userId });
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('agent-aware resolution', () => {
    it('prefers the base row mounted by the agent over a free base row', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const free = await model.create({ ...base, identifier: 'linear' });
      const mounted = await model.create({
        ...base,
        identifier: 'linear',
        metadata: { mountedByAgentId: agentId },
      });

      const resolved = await model.resolveByIdentifiers(['linear'], agentId);

      expect(resolved.map((row) => row.id)).toEqual([mounted.id]);
      // Without an agent, only the free row is a candidate.
      expect((await model.resolveByIdentifiers(['linear'])).map((row) => row.id)).toEqual([
        free.id,
      ]);
    });

    it('keeps one row per identifier when duplicates share the same priority', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const first = await model.create({ ...base, identifier: 'notion' });
      const second = await model.create({ ...base, identifier: 'notion' });

      const resolved = await model.resolveAll();

      expect(resolved).toHaveLength(1);
      expect([first.id, second.id]).toContain(resolved[0].id);
    });
  });

  describe('empty identifier lists', () => {
    it('returns [] without querying', async () => {
      const model = new ConnectorModel(serverDB, userId);
      await model.create({ ...base, identifier: 'linear' });

      expect(await model.resolveByIdentifiers([])).toEqual([]);
      expect(await model.queryReferencesByIdentifiers([])).toEqual([]);
      expect(await model.queryComposioReferencesByIdentifiers([])).toEqual([]);
    });
  });

  describe('missing rows', () => {
    it('copyToAgent returns null and creates nothing for an unknown source', async () => {
      const model = new ConnectorModel(serverDB, userId);

      expect(await model.copyToAgent(missingId, agentId)).toBeNull();
      expect(
        await serverDB.select().from(userConnectors).where(eq(userConnectors.userId, userId)),
      ).toEqual([]);
    });

    it('findPublicById returns null for an unknown id', async () => {
      const model = new ConnectorModel(serverDB, userId);

      expect(await model.findPublicById(missingId)).toBeNull();
    });

    it('markComposioConnectionUnavailable returns false for missing or non-Composio rows', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const plain = await model.create({ ...base, identifier: 'linear' });

      expect(await model.markComposioConnectionUnavailable(missingId, 'ca-1')).toBe(false);
      expect(await model.markComposioConnectionUnavailable(plain.id, 'ca-1')).toBe(false);

      const [row] = await serverDB
        .select()
        .from(userConnectors)
        .where(eq(userConnectors.id, plain.id));
      expect(row.status).toBe('connected');
    });
  });

  describe('queryComposioReferencesByIdentifiers', () => {
    it('omits the composio block for rows without Composio metadata', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const plain = await model.create({ ...base, identifier: 'linear' });
      const linked = await model.create({
        ...base,
        identifier: 'gmail',
        metadata: { composio },
      });

      const refs = await model.queryComposioReferencesByIdentifiers(['linear', 'gmail']);
      const byId = new Map(refs.map((ref) => [ref.id, ref]));

      expect(byId.get(plain.id)).toEqual({ id: plain.id, isEnabled: true, status: 'connected' });
      expect(byId.get(linked.id)).toEqual({
        composio: {
          appSlug: 'gmail',
          connectedAccountId: 'ca-1',
          ownerUserId: userId,
          status: 'ACTIVE',
        },
        id: linked.id,
        isEnabled: true,
        status: 'connected',
      });
    });
  });
});
