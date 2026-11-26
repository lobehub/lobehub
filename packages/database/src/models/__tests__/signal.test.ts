// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { signals, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SignalModel } from '../signal';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'signal-model-user';

const delivery = (externalId = 'evt_1') => ({
  externalId,
  occurredAt: new Date('2026-10-02T00:00:00Z'),
  payload: { id: externalId, type: 'message.received' },
  source: 'agent-mail',
  type: 'message.received',
});

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('SignalModel', () => {
  it('records an event once and hands a redelivery the stored signal', async () => {
    const first = await SignalModel.record(serverDB, delivery(), { userId });
    const again = await SignalModel.record(serverDB, delivery(), { userId });

    expect(first).toMatchObject({ created: true, signal: { status: 'pending' } });
    expect(again).toEqual({ created: false, signal: first.signal });
    expect(await serverDB.select().from(signals)).toHaveLength(1);
  });

  it('keeps how each processing attempt ended, so a failed signal can be retried', async () => {
    const { signal } = await SignalModel.record(serverDB, delivery(), { userId });

    await SignalModel.markFailed(serverDB, signal.id, 'wake: start-failed');
    let [row] = await serverDB.select().from(signals).where(eq(signals.id, signal.id));
    expect(row).toMatchObject({
      attempts: 1,
      error: 'wake: start-failed',
      processedAt: null,
      status: 'failed',
    });

    await SignalModel.markProcessed(serverDB, signal.id);
    [row] = await serverDB.select().from(signals).where(eq(signals.id, signal.id));
    expect(row).toMatchObject({ attempts: 2, error: null, status: 'processed' });
    expect(row.processedAt).toBeInstanceOf(Date);
  });

  it('records why an authentic event produced nothing', async () => {
    const { signal } = await SignalModel.record(serverDB, delivery('evt_robot'), { userId });

    await SignalModel.markIgnored(serverDB, signal.id, 'filtered');

    const [row] = await serverDB.select().from(signals).where(eq(signals.id, signal.id));
    expect(row).toMatchObject({ attempts: 1, error: 'filtered', status: 'ignored' });
  });
});
