// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acceptances,
  scmChangeRequests,
  scmIdentities,
  topics,
  users,
  verifyRuns,
  works,
  workspaceMembers,
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

  /** A workspace plus an active membership for `member`. */
  const workspaceWith = async (slug: string, member: string) => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'ws', primaryOwnerId: member, slug })
      .returning();
    await serverDB
      .insert(workspaceMembers)
      .values({ role: 'owner', userId: member, workspaceId: workspace.id });
    return workspace;
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
    const workspace = await workspaceWith('scm-links-ws-match', userId);
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

  it('drops a workspace record once the author has left that workspace', async () => {
    const workspace = await workspaceWith('scm-links-left-ws', userId);
    await serverDB.insert(acceptances).values({
      id: acceptanceId,
      subjectId: 's',
      subjectType: 'standalone',
      userId,
      workspaceId: workspace.id,
    });
    const body = `Acceptance: https://app.lobehub.com/acceptance/${acceptanceId}`;
    const scope = { kind: 'author', userId } as const;

    expect(await resolve({ ...base, body, scope })).toEqual({ acceptanceId });

    // Membership is soft-deleted, but the creator id stays on the record —
    // owning it once must not keep it reachable, or a former member could
    // still have it accepted by merging a pull request.
    await serverDB
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceMembers.userId, userId));

    expect(await resolve({ ...base, body, scope })).toEqual({});
  });

  it('does not let a read-only viewer reach workspace records', async () => {
    const workspace = await workspaceWith('scm-links-viewer-ws', userId);
    await serverDB.insert(acceptances).values({
      id: acceptanceId,
      subjectId: 's',
      subjectType: 'standalone',
      userId,
      workspaceId: workspace.id,
    });
    const body = `Acceptance: https://app.lobehub.com/acceptance/${acceptanceId}`;
    const scope = { kind: 'author', userId } as const;

    // Downgraded after creating it: a viewer cannot accept it in the app,
    // so a merge must not do it for them.
    await serverDB
      .update(workspaceMembers)
      .set({ role: 'viewer' })
      .where(eq(workspaceMembers.userId, userId));

    expect(await resolve({ ...base, body, scope })).toEqual({});
  });

  it('keeps every link inside the first scope that matched', async () => {
    // The body names an acceptance in workspace A; a Work for the same pull
    // request sits in workspace B. Taking both would report one workspace
    // and hand the control half a topic that does not live there.
    const a = await workspaceWith('scm-links-ws-a', userId);
    const b = await workspaceWith('scm-links-ws-b', userId);
    await serverDB.insert(acceptances).values({
      id: acceptanceId,
      subjectId: 's',
      subjectType: 'standalone',
      userId,
      workspaceId: a.id,
    });
    const [topic] = await serverDB.insert(topics).values({ title: 't', userId }).returning();
    await serverDB.insert(works).values({
      originTopicId: topic.id,
      resourceId: 'lobehub/lobehub#19719',
      resourceType: 'github_pull_request',
      toolIdentifier: 'lobe-local-system',
      toolName: 'runCommand',
      type: 'external',
      userId,
      visibility: 'private',
      workspaceId: b.id,
    });

    const resolved = await resolveChangeRequestLinks(serverDB, {
      ...base,
      body: `Acceptance: https://app.lobehub.com/acceptance/${acceptanceId}`,
      scope: { kind: 'author', userId },
    });

    expect(resolved.workspaceId).toBe(a.id);
    expect(resolved.links).toEqual({ acceptanceId });
    expect(resolved.links.workId).toBeUndefined();
    expect(resolved.links.topicId).toBeUndefined();
  });

  it("finds a teammate's hand link in a workspace the author can write to", async () => {
    // A bot verified the delivery and linked the PR; a person opened it.
    const workspace = await workspaceWith('scm-links-hand-ws', otherUserId);
    const handLink = {
      linkedAt: new Date().toISOString(),
      number: 19_719,
      provider: 'github' as const,
      repoFullName: 'LobeHub/LobeHub',
      url: 'https://github.com/LobeHub/LobeHub/pull/19719',
    };
    const [topic] = await serverDB
      .insert(topics)
      .values({ title: 't', userId: otherUserId })
      .returning();
    await serverDB.insert(acceptances).values({
      id: acceptanceId,
      metadata: { pullRequests: [handLink] },
      subjectId: topic.id,
      subjectType: 'topic' as const,
      userId: otherUserId,
      workspaceId: workspace.id,
    });
    const scope = { kind: 'author', userId } as const;

    // Not a member: the link stays out of reach.
    expect(await resolve({ ...base, scope })).toEqual({});

    await serverDB
      .insert(workspaceMembers)
      .values({ role: 'member', userId, workspaceId: workspace.id });
    const resolved = await resolveChangeRequestLinks(serverDB, { ...base, scope });
    // The acceptance only: a hand link does not hand over the subject's conversation.
    // It is flagged as hand-sourced so the model revalidates it before writing.
    expect(resolved).toEqual({
      links: { acceptanceId, acceptanceSource: 'hand-link' },
      workspaceId: workspace.id,
    });

    // Another PR number in the same repository is not linked.
    expect(await resolve({ ...base, number: 19_720, scope })).toEqual({});
  });

  it("finds a teammate's round in a workspace the author can write to", async () => {
    // A teammate verified the delivery and ingested its rounds; the author
    // opened the PR and never touched the acceptance.
    const workspace = await workspaceWith('scm-links-run-ws', otherUserId);
    await serverDB.insert(acceptances).values({
      id: acceptanceId,
      subjectId: 's',
      subjectType: 'standalone',
      userId: otherUserId,
      workspaceId: workspace.id,
    });
    await serverDB.insert(verifyRuns).values({
      acceptanceId,
      context: { pullRequest: { number: 19_719, url: base.url } },
      roundIndex: 1,
      scenario: 'coding',
      userId: otherUserId,
      workspaceId: workspace.id,
    });
    const scope = { kind: 'author', userId } as const;

    // Not a member: the round stays out of reach.
    expect(await resolve({ ...base, scope })).toEqual({});

    // A viewer cannot accept it in the app, so a merge must not either.
    await serverDB
      .insert(workspaceMembers)
      .values({ role: 'viewer', userId, workspaceId: workspace.id });
    expect(await resolve({ ...base, scope })).toEqual({});

    await serverDB
      .update(workspaceMembers)
      .set({ role: 'member' })
      .where(eq(workspaceMembers.userId, userId));
    expect(await resolveChangeRequestLinks(serverDB, { ...base, scope })).toEqual({
      links: { acceptanceId },
      workspaceId: workspace.id,
    });
  });

  it('keeps the acceptance the row already carries over a later hand link', async () => {
    // Two acceptances list the same PR: the first claimed the row, the second
    // was refused by `link-pr` and kept its link. The newest link must not
    // decide what a merge accepts.
    const workspace = await workspaceWith('scm-links-claimed-ws', userId);
    // One acceptance per subject, so the two links sit on different topics.
    const [claimedTopic, laterTopic] = await serverDB
      .insert(topics)
      .values([
        { title: 'claimed', userId },
        { title: 'later', userId },
      ])
      .returning();
    const laterId = '11111111-2222-4333-8444-555555555555';
    const handLink = (at: string) => ({
      linkedAt: at,
      number: 19_719,
      provider: 'github' as const,
      repoFullName: 'lobehub/lobehub',
      url: 'https://github.com/lobehub/lobehub/pull/19719',
    });

    await serverDB.insert(acceptances).values([
      {
        id: acceptanceId,
        metadata: { pullRequests: [handLink('2026-10-01T00:00:00.000Z')] },
        subjectId: claimedTopic.id,
        subjectType: 'topic' as const,
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
        userId,
        workspaceId: workspace.id,
      },
      {
        id: laterId,
        metadata: { pullRequests: [handLink('2026-10-20T00:00:00.000Z')] },
        subjectId: laterTopic.id,
        subjectType: 'topic' as const,
        updatedAt: new Date('2026-10-20T00:00:00.000Z'),
        userId,
        workspaceId: workspace.id,
      },
    ]);
    await serverDB.insert(scmChangeRequests).values({
      acceptanceId,
      number: 19_719,
      provider: 'github',
      repoFullName: 'lobehub/lobehub',
      state: 'open',
      url: base.url,
      userId,
      workspaceId: workspace.id,
    });

    const scope = { kind: 'author', userId } as const;
    const resolved = await resolveChangeRequestLinks(serverDB, { ...base, scope });

    // The row's own binding, echoed: the model lets the locked row decide.
    expect(resolved).toEqual({
      links: { acceptanceId, acceptanceSource: 'row-binding' },
      workspaceId: workspace.id,
    });

    // With the binding gone the remaining link takes over again.
    await serverDB.update(scmChangeRequests).set({ acceptanceId: null });
    expect(await resolve({ ...base, scope })).toEqual({
      acceptanceId: laterId,
      acceptanceSource: 'hand-link',
    });
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
