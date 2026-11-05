import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, userConnectors, userConnectorTools, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ConnectorRepository } from '../index';

const db = await getTestDB();

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: 'copy-owner' });
  await db.insert(agents).values({ id: 'copy-agent', userId: 'copy-owner' });
});

/** Inject a tool-write failure while retaining the real database transaction. */
const failToolInsert = (database: LobeChatDatabase): LobeChatDatabase =>
  new Proxy(database, {
    get(target, key) {
      if (key === 'insert')
        return (table: unknown) => {
          if (table === userConnectorTools) throw new Error('Tool copy failed');
          return target.insert(table as typeof userConnectors);
        };
      if (key === 'transaction')
        return (run: (tx: LobeChatDatabase) => Promise<unknown>) =>
          target.transaction((tx) => run(failToolInsert(tx as LobeChatDatabase)));
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

describe('connector copy atomicity', () => {
  it('does not leave a connector without tools when copying fails', async () => {
    const [source] = await db
      .insert(userConnectors)
      .values({
        identifier: 'gmail',
        name: 'Gmail',
        sourceType: 'marketplace',
        status: 'connected',
        userId: 'copy-owner',
      })
      .returning();
    await db.insert(userConnectorTools).values({
      crudType: 'read',
      permission: 'auto',
      toolName: 'GMAIL_FETCH_EMAILS',
      userConnectorId: source.id,
      userId: 'copy-owner',
    });

    await expect(
      new ConnectorRepository(failToolInsert(db), 'copy-owner').copyToAgent(
        source.id,
        'copy-agent',
      ),
    ).rejects.toThrow('Tool copy failed');

    const remaining = await db
      .select({ id: userConnectors.id })
      .from(userConnectors)
      .where(eq(userConnectors.userId, 'copy-owner'));
    expect(remaining).toEqual([{ id: source.id }]);
    expect(await db.select().from(userConnectorTools)).toHaveLength(1);
  });
});
