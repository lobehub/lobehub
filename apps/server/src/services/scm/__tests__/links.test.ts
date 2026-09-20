// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acceptances, topics, users, verifyRuns, works } from '@/database/schemas';

import { parseAcceptanceIds, resolveChangeRequestLinks } from '../links';

const serverDB = await getTestDB();
const userId = 'scm-links-user';
const otherUserId = 'scm-links-user-2';
const acceptanceId = '0f1e2d3c-4b5a-4c6d-8e9f-0a1b2c3d4e5f';

describe('parseAcceptanceIds', () => {
  it('finds acceptance ids in any host and de-duplicates them', () => {
    const text = [
      `- Acceptance: https://app.lobehub.com/acceptance/${acceptanceId}`,
      `see http://localhost:3010/acceptance/${acceptanceId.toUpperCase()}?r=2`,
      'and https://app.lobehub.com/acceptance/11111111-2222-4333-8444-555555555555',
      'not https://app.lobehub.com/acceptance/not-a-uuid',
    ].join('\n');

    expect(parseAcceptanceIds(text)).toEqual([
      acceptanceId,
      '11111111-2222-4333-8444-555555555555',
    ]);
    expect(parseAcceptanceIds(null)).toEqual([]);
  });
});

describe('resolveChangeRequestLinks', () => {
  beforeEach(async () => {
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  const base = {
    number: 19_719,
    repoFullName: 'lobehub/lobehub',
    scope: { userId },
    url: 'https://github.com/lobehub/lobehub/pull/19719',
  };

  it('links the acceptance named in the body and its topic subject', async () => {
    const [topic] = await serverDB.insert(topics).values({ title: 't', userId }).returning();
    await serverDB
      .insert(acceptances)
      .values({ id: acceptanceId, subjectId: topic.id, subjectType: 'topic', userId });

    const links = await resolveChangeRequestLinks(serverDB, {
      ...base,
      body: `Acceptance: https://app.lobehub.com/acceptance/${acceptanceId}`,
    });

    expect(links).toEqual({ acceptanceId, topicId: topic.id });
  });

  it('skips body ids that do not exist and falls through to the Work', async () => {
    const [topic] = await serverDB.insert(topics).values({ title: 't', userId }).returning();
    const [work] = await serverDB
      .insert(works)
      .values({
        originTopicId: topic.id,
        resourceId: 'lobehub/lobehub#19719',
        resourceType: 'github_pull_request',
        toolIdentifier: 'lobe-local-system',
        toolName: 'runCommand',
        type: 'external',
        userId,
        visibility: 'private',
      })
      .returning();

    const links = await resolveChangeRequestLinks(serverDB, {
      ...base,
      body: 'Acceptance: https://app.lobehub.com/acceptance/11111111-2222-4333-8444-555555555555',
    });

    expect(links).toEqual({ topicId: topic.id, workId: work.id });
  });

  it("prefers the Work registered in the installation scope over another user's", async () => {
    const insert = (owner: string) =>
      serverDB
        .insert(works)
        .values({
          resourceId: 'lobehub/lobehub#19719',
          resourceType: 'github_pull_request',
          toolIdentifier: 'lobe-local-system',
          toolName: 'runCommand',
          type: 'external',
          userId: owner,
          visibility: 'private',
        })
        .returning();
    const [theirs] = await insert(otherUserId);
    const [mine] = await insert(userId);
    expect(theirs.id).not.toBe(mine.id);

    const links = await resolveChangeRequestLinks(serverDB, base);
    expect(links.workId).toBe(mine.id);
  });

  it('falls back to the acceptance round that ingested the PR url', async () => {
    await serverDB
      .insert(acceptances)
      .values({ id: acceptanceId, subjectId: 'standalone-1', subjectType: 'standalone', userId });
    await serverDB.insert(verifyRuns).values({
      acceptanceId,
      context: { pullRequest: { number: 19_719, url: base.url } },
      roundIndex: 1,
      scenario: 'coding',
      userId,
    });

    const links = await resolveChangeRequestLinks(serverDB, base);
    expect(links).toEqual({ acceptanceId });
  });

  it('returns nothing when no source matches', async () => {
    expect(await resolveChangeRequestLinks(serverDB, base)).toEqual({});
  });
});
