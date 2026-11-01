// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acceptances, users } from '@/database/schemas';

import { parseChangeRequestUrl } from '../../scm/changeRequestUrl';
import { addPullRequestLink, updateAcceptancePullRequests } from '../acceptancePullRequests';

const serverDB = await getTestDB();
const userId = 'acceptance-pr-link-user';

const parse = (url: string) => {
  const parsed = parseChangeRequestUrl(url);
  if (!parsed) throw new Error(`not a PR url: ${url}`);
  return parsed;
};

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('updateAcceptancePullRequests', () => {
  it('keeps both stacked PRs linked concurrently and leaves other metadata alone', async () => {
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({
        metadata: { title: 'Durable waits' },
        subjectId: 's',
        subjectType: 'standalone',
        userId,
      })
      .returning();

    await Promise.all(
      [20426, 20427].map((number) =>
        updateAcceptancePullRequests(serverDB, acceptance.id, (links) =>
          addPullRequestLink(
            links,
            parse(`https://github.com/lobehub/lobehub/pull/${number}`),
            undefined,
          ),
        ),
      ),
    );

    const stored = await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.id, acceptance.id),
    });
    expect(stored?.metadata?.title).toBe('Durable waits');
    expect(stored?.metadata?.pullRequests?.map((link) => link.number).sort()).toEqual([
      20426, 20427,
    ]);
  });

  it('writes nothing when the update declines', async () => {
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ subjectId: 's2', subjectType: 'standalone', userId })
      .returning();

    expect(await updateAcceptancePullRequests(serverDB, acceptance.id, () => null)).toBeNull();
    const stored = await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.id, acceptance.id),
    });
    expect(stored?.metadata?.pullRequests).toBeUndefined();
  });
});
