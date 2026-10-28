// Fixture: tRPC procedures that exist and refuse writes to one kind of record.
import { beforeEach, expect, it } from 'vitest';

import { acceptanceRouter } from './acceptance';
import { createSiteReview, createTestUsers } from './fixtures';

let adminId: string;
let ownerId: string;
let acceptanceId: string;

const caller = (userId: string) => acceptanceRouter.createCaller({ userId } as any);

beforeEach(async () => {
  ({ adminId, ownerId } = await createTestUsers());
  acceptanceId = (await createSiteReview({ createdBy: adminId })).acceptanceId;
});

it('refuses visibility changes, renames and deletion even to the person who created the site', async () => {
  await expect(
    caller(adminId).setVisibility({ id: acceptanceId, visibility: 'public' }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(caller(adminId).remove({ id: acceptanceId })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(caller(ownerId).rename({ id: acceptanceId, title: 'x' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});
