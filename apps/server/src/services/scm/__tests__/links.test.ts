// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acceptances,
  scmIdentities,
  topics,
  users,
  verifyRuns,
  works,
  workspaces,
} from '@/database/schemas';

import { parseAcceptanceIds, resolveChangeRequestLinks, resolveChangeRequestOwner } from '../links';

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
    await serverDB.delete(workspaces);
    await serverDB.delete(users);
  });

  const base = {
    number: 19_719,
    repoFullName: 'lobehub/lobehub',
    scope: { kind: 'installation', userId, workspaceId: null } as const,
    url: 'https://github.com/lobehub/lobehub/pull/19719',
  };

  /** The links half of the result; the workspace half is asserted on its own. */
  const resolve = async (params: Parameters<typeof resolveChangeRequestLinks>[1]) =>
    (await resolveChangeRequestLinks(serverDB, params)).links;

  it('links the acceptance named in the body and its topic subject', async () => {
    const [topic] = await serverDB.insert(topics).values({ title: 't', userId }).returning();
    await serverDB
      .insert(acceptances)
      .values({ id: acceptanceId, subjectId: topic.id, subjectType: 'topic', userId });

    const links = await resolve({
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

    const links = await resolve({
      ...base,
      body: 'Acceptance: https://app.lobehub.com/acceptance/11111111-2222-4333-8444-555555555555',
    });

    expect(links).toEqual({ topicId: topic.id, workId: work.id });
  });

  it("never crosses tenants: another user's acceptance, Work and round are invisible", async () => {
    const insertWork = (owner: string) =>
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
    const [theirs] = await insertWork(otherUserId);
    await serverDB
      .insert(acceptances)
      .values({ id: acceptanceId, subjectId: 's', subjectType: 'standalone', userId: otherUserId });
    await serverDB.insert(verifyRuns).values({
      acceptanceId,
      context: { pullRequest: { number: 19_719, url: base.url } },
      roundIndex: 1,
      scenario: 'coding',
      userId: otherUserId,
    });

    // A body naming their acceptance, a Work they registered, a round they
    // ingested: none of it links from my installation.
    expect(
      await resolve({
        ...base,
        body: `Acceptance: https://app.lobehub.com/acceptance/${acceptanceId}`,
      }),
    ).toEqual({});

    // Once I register my own Work it wins, and theirs still does not leak in.
    const [mine] = await insertWork(userId);
    expect(mine.id).not.toBe(theirs.id);
    expect((await resolve(base)).workId).toBe(mine.id);
  });

  it('separates a workspace installation from personal records of the same user', async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'ws', primaryOwnerId: userId, slug: 'scm-links-ws' })
      .returning();
    await serverDB
      .insert(acceptances)
      .values({ id: acceptanceId, subjectId: 's', subjectType: 'standalone', userId });
    const body = `Acceptance: https://app.lobehub.com/acceptance/${acceptanceId}`;

    expect(
      await resolve({
        ...base,
        body,
        scope: { kind: 'installation', userId, workspaceId: workspace.id },
      }),
    ).toEqual({});
    expect(await resolve({ ...base, body })).toEqual({ acceptanceId });
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

    const links = await resolve(base);
    expect(links).toEqual({ acceptanceId });
  });

  it("reaches the author's personal records from a workspace installation", async () => {
    // The org installed the App on its workspace; a member opened the pull
    // request from a personal agent that is not in that workspace at all.
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'ws', primaryOwnerId: otherUserId, slug: 'scm-links-author-ws' })
      .returning();
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

    // The installation's own tenant sees nothing — that is today's dead end.
    expect(
      await resolve({
        ...base,
        scope: { kind: 'installation', userId: otherUserId, workspaceId: workspace.id },
      }),
    ).toEqual({});

    // Routed by the author, the personal conversation is found, and the
    // result says the records are personal so the wake looks there.
    const resolved = await resolveChangeRequestLinks(serverDB, {
      ...base,
      scope: { kind: 'author', userId },
    });
    expect(resolved.links).toEqual({ topicId: topic.id, workId: work.id });
    expect(resolved.workspaceId).toBeNull();
  });

  it('reports the workspace of the records it matched, not the installation', async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'ws', primaryOwnerId: userId, slug: 'scm-links-ws-match' })
      .returning();
    await serverDB.insert(acceptances).values({
      id: acceptanceId,
      subjectId: 's',
      subjectType: 'standalone',
      userId,
      workspaceId: workspace.id,
    });

    const resolved = await resolveChangeRequestLinks(serverDB, {
      ...base,
      body: `Acceptance: https://app.lobehub.com/acceptance/${acceptanceId}`,
      scope: { kind: 'author', userId },
    });
    expect(resolved.links).toEqual({ acceptanceId });
    expect(resolved.workspaceId).toBe(workspace.id);
  });

  it("still refuses another person's records when routing by author", async () => {
    await serverDB
      .insert(acceptances)
      .values({ id: acceptanceId, subjectId: 's', subjectType: 'standalone', userId: otherUserId });

    // The body names it, but the author is someone else.
    expect(
      await resolve({
        ...base,
        body: `Acceptance: https://app.lobehub.com/acceptance/${acceptanceId}`,
        scope: { kind: 'author', userId },
      }),
    ).toEqual({});
  });

  it('returns nothing when no source matches', async () => {
    expect(await resolve(base)).toEqual({});
  });

  describe('resolveChangeRequestOwner', () => {
    const installation = { userId: otherUserId, workspaceId: 'ws-1' };

    it('routes to the LobeHub user who linked the authoring GitHub account', async () => {
      // Inserted directly: only the identity's owner matters here, and the
      // credential column needs a key vault the test does not have.
      await serverDB.insert(scmIdentities).values({
        externalLogin: 'arvinxx',
        externalUserId: '28616219',
        provider: 'github',
        userId,
      });

      expect(
        await resolveChangeRequestOwner(serverDB, {
          authorExternalId: '28616219',
          installation,
          provider: 'github',
        }),
      ).toEqual({ kind: 'author', userId });
    });

    it("falls back to the installation's tenant for an author we cannot name", async () => {
      // A bot opened it, or the author never linked their account: guessing
      // would be worse than the narrow answer.
      for (const authorExternalId of ['99999999', null, undefined]) {
        expect(
          await resolveChangeRequestOwner(serverDB, {
            authorExternalId,
            installation,
            provider: 'github',
          }),
        ).toEqual({ kind: 'installation', userId: otherUserId, workspaceId: 'ws-1' });
      }
    });
  });
});
