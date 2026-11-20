// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { TrashModel } from './trash';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'trash-guards-user';
const model = new TrashModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  for (let i = 0; i < 3; i++) {
    await model.register({
      deletedAt: new Date(`2026-08-0${i + 1}T00:00:00Z`),
      root: { projectId: null, resourceId: `agt_${i}`, resourceType: 'agent', title: `a${i}` },
    });
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('TrashModel.list cursor guard', () => {
  it('restarts from the first page when decoding the cursor throws', async () => {
    const first = await model.list({ limit: 2 });
    expect(first.items.map((item) => item.resourceId)).toEqual(['agt_2', 'agt_1']);
    expect(first.nextCursor).toBeTruthy();

    // Only the cursor decode passes 'base64url' to Buffer.from; the driver's own calls do not.
    const from = Buffer.from;
    const decode = vi.spyOn(Buffer, 'from').mockImplementation(((...args: unknown[]) => {
      if (args[1] === 'base64url') throw new TypeError('Unknown encoding: base64url');
      return (from as (...a: unknown[]) => Buffer)(...args);
    }) as typeof Buffer.from);

    const page = await model.list({ cursor: first.nextCursor, limit: 2 });
    const threw = decode.mock.results.some((result) => result.type === 'throw');
    decode.mockRestore();

    expect(threw).toBe(true);
    // An unreadable cursor is treated as no cursor, not as an error or an empty page.
    expect(page.items.map((item) => item.resourceId)).toEqual(['agt_2', 'agt_1']);
    expect(page.nextCursor).toBe(first.nextCursor);
  });
});
