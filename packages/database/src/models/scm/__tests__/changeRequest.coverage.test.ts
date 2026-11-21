// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { acceptances, users } from '../../../schemas';
import { ScmChangeRequestModel } from '../changeRequest';

const serverDB = await getTestDB();
const userId = 'scm-change-request-coverage-user';

const sha1 = 'a'.repeat(40);

const snapshot = {
  headSha: sha1,
  number: 7,
  provider: 'github' as const,
  repoFullName: 'lobehub-cov/change-request',
  state: 'open' as const,
  url: 'https://github.com/lobehub-cov/change-request/pull/7',
  userId,
};

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  // Change requests and acceptances cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('ScmChangeRequestModel coverage', () => {
  it('finds a row by a pasted repository name whatever its casing', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      repoFullName: 'LobeHub-Cov/Change-Request',
    });

    const found = await ScmChangeRequestModel.findByIdentityIgnoringCase(
      serverDB,
      'github',
      'lobehub-cov/CHANGE-REQUEST',
      7,
    );
    expect(found?.id).toBe(row.id);
    expect(found?.repoFullName).toBe('LobeHub-Cov/Change-Request');

    expect(
      await ScmChangeRequestModel.findByIdentityIgnoringCase(
        serverDB,
        'github',
        'lobehub-cov/change-request',
        8,
      ),
    ).toBeNull();
  });

  it('lets only one acceptance hold the row, and detaches only its own claim', async () => {
    const [first, second] = await serverDB
      .insert(acceptances)
      .values([
        { subjectId: 'scm-cov-first', subjectType: 'standalone', userId },
        { subjectId: 'scm-cov-second', subjectType: 'standalone', userId },
      ])
      .returning();
    const row = await ScmChangeRequestModel.upsert(serverDB, snapshot);

    expect(
      (await ScmChangeRequestModel.claimAcceptance(serverDB, row.id, first.id))?.acceptanceId,
    ).toBe(first.id);
    // Re-claiming is idempotent for the holder; a rival claim is refused.
    expect(
      (await ScmChangeRequestModel.claimAcceptance(serverDB, row.id, first.id))?.acceptanceId,
    ).toBe(first.id);
    expect(await ScmChangeRequestModel.claimAcceptance(serverDB, row.id, second.id)).toBeNull();

    // A rival cannot detach the holder's claim.
    await ScmChangeRequestModel.detachAcceptance(serverDB, row.id, second.id);
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.acceptanceId).toBe(first.id);

    await ScmChangeRequestModel.detachAcceptance(serverDB, row.id, first.id);
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.acceptanceId).toBeNull();

    // Once released, the rival may claim it.
    expect(
      (await ScmChangeRequestModel.claimAcceptance(serverDB, row.id, second.id))?.acceptanceId,
    ).toBe(second.id);
  });

  it('keeps a hand-linked acceptance the row already carries without re-checking the link', async () => {
    const [linked] = await serverDB
      .insert(acceptances)
      .values({
        metadata: {
          pullRequests: [
            {
              linkedAt: '2026-10-28T00:00:00.000Z',
              number: snapshot.number,
              provider: snapshot.provider,
              repoFullName: snapshot.repoFullName,
              url: snapshot.url,
            },
          ],
        },
        subjectId: 'scm-cov-linked',
        subjectType: 'standalone',
        userId,
      })
      .returning();
    const links = { acceptanceId: linked.id, acceptanceSource: 'hand-link' as const };
    const first = await ScmChangeRequestModel.upsert(serverDB, { ...snapshot, links });
    expect(first.acceptanceId).toBe(linked.id);

    // The hand link is gone by now, but the row already holds this acceptance:
    // re-asserting it is not a new binding, so nothing is re-checked or cleared.
    await serverDB.update(acceptances).set({ metadata: {} }).where(eq(acceptances.id, linked.id));
    const again = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      eventKind: 'review_commented',
      links,
    });

    expect(again.acceptanceId).toBe(linked.id);
  });
});
