// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { agents, agentShares, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { createProxyTestDB } from './__tests__/_proxyTestDB';
import { AgentShareModel } from './agentShare';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-share-guards-user';
const agentId = 'agent-share-guards-agent';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, slug: 'guarded-agent', userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('AgentShareModel.create slug seed guard', () => {
  it('keeps the freshly inserted share when the slug-seed UPDATE returns no row', async () => {
    // The seed UPDATE reports no row back, the answer it would give if the row it just
    // inserted had already gone; every other statement, the INSERT included, is untouched.
    const model = new AgentShareModel(
      createProxyTestDB(serverDB, (query, result) =>
        query.startsWith('update "agent_shares" set "share_config"') ? [] : result.rows,
      ),
      userId,
    );

    const share = await model.create(agentId);

    const [stored] = await serverDB
      .select()
      .from(agentShares)
      .where(eq(agentShares.agentId, agentId));
    // The seed UPDATE really ran (the stored row carries the slug); only its returned row was lost.
    expect(stored.shareConfig?.slug).toBe('guarded-agent');
    // Creation still succeeds with the inserted row, just without the seeded slug.
    expect(share).toMatchObject({ agentId, id: stored.id, visibility: 'private' });
    expect(share.shareConfig.slug).toBeUndefined();
  });
});
