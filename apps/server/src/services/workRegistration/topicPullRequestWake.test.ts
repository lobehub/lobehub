// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ScmChangeRequestModel } from '@/database/models/scm';
import { TopicModel } from '@/database/models/topic';
import { WorkModel } from '@/database/models/work';
import {
  scmChangeRequests,
  topics,
  users,
  works,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';

import { linkTopicPullRequest, setTopicPullRequestDismissed } from './topicPullRequestLinks';
import { listTopicPullRequestsWithStatus } from './topicPullRequests';
import { bindTopicPullRequestWake, releaseTopicPullRequestWake } from './topicPullRequestWake';

const serverDB = await getTestDB();

const author = 'tpr-wake-author';
const teammate = 'tpr-wake-teammate';
const workspaceId = 'tpr-wake-ws';
const otherWorkspaceId = 'tpr-wake-ws-other';

const pr = { number: 46, repoFullName: 'ImSingee/aidy-tophant' };
const url = 'https://github.com/ImSingee/aidy-tophant/pull/46';
/** As a person pastes it: GitHub names are case-insensitive. */
const pasted = { number: 46, repoFullName: 'imsingee/AIDY-tophant' };

const personal = { userId: author, workspaceId: null };
const inWorkspace = { userId: author, workspaceId };

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: author }, { id: teammate }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: workspaceId, primaryOwnerId: author, slug: workspaceId },
    {
      id: otherWorkspaceId,
      name: otherWorkspaceId,
      primaryOwnerId: author,
      slug: otherWorkspaceId,
    },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: author, workspaceId },
    { role: 'member', userId: teammate, workspaceId },
  ]);
  await serverDB.insert(topics).values([
    { id: 'tpc-personal', title: 'Personal', userId: author },
    { id: 'tpc-ws', title: 'Workspace', userId: author, workspaceId },
    { id: 'tpc-ws-teammate', title: 'Teammate', userId: teammate, workspaceId },
    { id: 'tpc-work', title: 'Where the PR was opened', userId: author },
  ]);
});

afterEach(async () => {
  await serverDB.delete(scmChangeRequests);
  await serverDB.delete(works);
  await serverDB.delete(topics);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

const identifier = `${pasted.repoFullName}#${pasted.number}`;

/** The provider row the GitHub App keeps for the PR, routed like the ingest does. */
const trackedRow = (
  owner: { userId: string; workspaceId: string | null },
  links: { topicId?: string } = {},
  eventAt?: Date,
) =>
  ScmChangeRequestModel.upsert(serverDB, {
    eventAt,
    links,
    metadata: { routedBy: 'author' },
    number: pr.number,
    provider: 'github',
    repoFullName: pr.repoFullName,
    state: 'open',
    url,
    ...owner,
  });

const topicModelFor = (scope: { userId: string; workspaceId: string | null }) =>
  new TopicModel(serverDB, scope.userId, scope.workspaceId ?? undefined);

/** Keep the PR on the topic's own list, as `work.linkTopicPullRequest` does first. */
const listOn = (scope: { userId: string; workspaceId: string | null }, topicId: string) =>
  linkTopicPullRequest(topicModelFor(scope), topicId, {
    identifier,
    source: 'manual',
    url,
    vouched: true,
  });

const bind = (
  scope: { userId: string; workspaceId: string | null },
  topicId: string,
  topicModel: Pick<TopicModel, 'findById'> = topicModelFor(scope),
) =>
  bindTopicPullRequestWake({
    db: serverDB,
    pr: pasted,
    scope,
    topicId,
    topicModel: topicModel as TopicModel,
  });

const release = (
  topicId: string,
  topicModel: Pick<TopicModel, 'findById'> = topicModelFor(personal),
) =>
  releaseTopicPullRequestWake({
    db: serverDB,
    pr: pasted,
    topicId,
    topicModel: topicModel as TopicModel,
  });

/** "Remove from this topic", as `work.setTopicPullRequestDismissed` does it. */
const removeFrom = async (topicId: string) => {
  await setTopicPullRequestDismissed(topicModelFor(personal), topicId, identifier, true);
  return release(topicId);
};

const rowNow = async () => {
  const [row] = await serverDB.select().from(scmChangeRequests);
  return row;
};

describe('bindTopicPullRequestWake', () => {
  it('makes the linking topic the one Auto-fix wakes, so the switch is its own', async () => {
    await trackedRow(personal);
    await listOn(personal, 'tpc-personal');

    expect(await bind(personal, 'tpc-personal')).toBe('bound');

    const row = await rowNow();
    expect(row.topicId).toBe('tpc-personal');
    expect(row.metadata.topicLink).toMatchObject({ topicId: 'tpc-personal' });
    // What the PR row menu reads: the topic owns Auto-fix now.
    const [item] = await listTopicPullRequestsWithStatus({
      db: serverDB,
      topicId: 'tpc-personal',
      topicModel: topicModelFor(personal),
      userId: author,
      workModel: new WorkModel(serverDB, author),
      workspaceId: null,
    });
    expect(item.scm?.autoFix).toMatchObject({ enabled: true, ownerTopicId: 'tpc-personal' });
  });

  it('binds inside a workspace for the PR owner', async () => {
    await trackedRow(inWorkspace);
    await listOn(inWorkspace, 'tpc-ws');

    expect(await bind(inWorkspace, 'tpc-ws')).toBe('bound');
    expect((await rowNow()).topicId).toBe('tpc-ws');
  });

  it('leaves a PR no installation tracks alone', async () => {
    await listOn(personal, 'tpc-personal');

    expect(await bind(personal, 'tpc-personal')).toBe('untracked');
    expect(await serverDB.select().from(scmChangeRequests)).toHaveLength(0);
  });

  it('never reaches across tenants', async () => {
    // A personal row, linked from a workspace topic.
    await trackedRow(personal);
    await listOn(inWorkspace, 'tpc-ws');
    expect(await bind(inWorkspace, 'tpc-ws')).toBe('foreign');
    expect((await rowNow()).topicId).toBeNull();

    // Another workspace's row, linked from this workspace.
    await serverDB.delete(scmChangeRequests);
    await trackedRow({ userId: author, workspaceId: otherWorkspaceId });
    expect(await bind(inWorkspace, 'tpc-ws')).toBe('foreign');

    // A workspace row, linked from the personal scope.
    await serverDB.delete(scmChangeRequests);
    await trackedRow(inWorkspace);
    await listOn(personal, 'tpc-personal');
    expect(await bind(personal, 'tpc-personal')).toBe('foreign');
    expect((await rowNow()).topicId).toBeNull();
  });

  it("will not let a teammate's pasted URL aim another member's PR at their conversation", async () => {
    await trackedRow(inWorkspace);
    const teammateScope = { userId: teammate, workspaceId };
    await listOn(teammateScope, 'tpc-ws-teammate');

    expect(await bind(teammateScope, 'tpc-ws-teammate')).toBe('foreign');
    expect((await rowNow()).topicId).toBeNull();
  });

  it('keeps a conversation an acceptance or a Work already set', async () => {
    await trackedRow(personal, { topicId: 'tpc-work' });
    await listOn(personal, 'tpc-personal');

    expect(await bind(personal, 'tpc-personal')).toBe('taken');
    const row = await rowNow();
    expect(row.topicId).toBe('tpc-work');
    expect(row.metadata.topicLink).toBeUndefined();

    // Seen from the linking topic, Auto-fix names the conversation it wakes.
    const [item] = await listTopicPullRequestsWithStatus({
      db: serverDB,
      topicId: 'tpc-personal',
      topicModel: topicModelFor(personal),
      userId: author,
      workModel: new WorkModel(serverDB, author),
      workspaceId: null,
    });
    expect(item.scm?.autoFix).toMatchObject({
      ownerTopic: { id: 'tpc-work', title: 'Where the PR was opened' },
      ownerTopicId: 'tpc-work',
    });
  });

  it("keeps another topic's earlier link, and is a no-op when it already is this topic", async () => {
    await trackedRow(personal);
    await listOn(personal, 'tpc-work');
    expect(await bind(personal, 'tpc-work')).toBe('bound');

    await listOn(personal, 'tpc-personal');
    expect(await bind(personal, 'tpc-personal')).toBe('taken');
    expect(await bind(personal, 'tpc-work')).toBe('kept');
    expect((await rowNow()).topicId).toBe('tpc-work');
  });

  it('undoes its claim when the PR was removed from the topic meanwhile', async () => {
    await trackedRow(personal);
    await listOn(personal, 'tpc-personal');
    await setTopicPullRequestDismissed(topicModelFor(personal), 'tpc-personal', identifier, true);

    expect(await bind(personal, 'tpc-personal')).toBe('withdrawn');
    const row = await rowNow();
    expect(row.topicId).toBeNull();
    expect(row.metadata.topicLink).toBeUndefined();
  });
  it('cannot undo a relink with a withdraw it decided before the relink', async () => {
    await trackedRow(personal);
    await listOn(personal, 'tpc-personal');
    const real = topicModelFor(personal);
    // The removal lands after this bind's claim (its own release ran first and
    // found nothing), so the bind reads a list without the PR. Before it
    // releases, the person links the PR again.
    const racing = {
      findById: async (id: string) => {
        await setTopicPullRequestDismissed(real, 'tpc-personal', identifier, true);
        const seen = await real.findById(id);
        await listOn(personal, 'tpc-personal');
        expect(await bind(personal, 'tpc-personal')).toBe('kept');
        return seen;
      },
    };

    expect(await bind(personal, 'tpc-personal', racing)).toBe('withdrawn');
    // The relink restamped the claim, so the stale withdraw released nothing.
    const row = await rowNow();
    expect(row.topicId).toBe('tpc-personal');
    expect(row.metadata.topicLink).toMatchObject({ topicId: 'tpc-personal' });
  });

  it('restamps the claim when the link already holds the slot', async () => {
    const row = await trackedRow(personal);
    const first = await ScmChangeRequestModel.claimTopicFromLink(
      serverDB,
      row.id,
      personal,
      'tpc-personal',
    );
    const second = await ScmChangeRequestModel.claimTopicFromLink(
      serverDB,
      row.id,
      personal,
      'tpc-personal',
    );
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    expect(
      await ScmChangeRequestModel.releaseTopicFromLink(serverDB, row.id, 'tpc-personal', first!),
    ).toBe(false);
    expect(
      await ScmChangeRequestModel.releaseTopicFromLink(serverDB, row.id, 'tpc-personal', second!),
    ).toBe(true);
  });
});

describe('releaseTopicPullRequestWake', () => {
  it("clears the conversation this topic's link set once the PR left its list", async () => {
    await trackedRow(personal);
    await listOn(personal, 'tpc-personal');
    await bind(personal, 'tpc-personal');

    // Still listed: nothing to release.
    expect(await release('tpc-personal')).toBe(false);
    expect((await rowNow()).topicId).toBe('tpc-personal');

    expect(await removeFrom('tpc-personal')).toBe(true);
    const row = await rowNow();
    expect(row.topicId).toBeNull();
    expect(row.metadata.topicLink).toBeUndefined();
    expect(row.metadata.routedBy).toBe('author');
  });

  it('cannot undo a relink with a removal it decided before the relink', async () => {
    await trackedRow(personal);
    await listOn(personal, 'tpc-personal');
    await bind(personal, 'tpc-personal');
    const real = topicModelFor(personal);
    await setTopicPullRequestDismissed(real, 'tpc-personal', identifier, true);
    // The removal reads a list without the PR; the relink and its bind land
    // before the removal's release.
    const racing = {
      findById: async (id: string) => {
        const seen = await real.findById(id);
        await listOn(personal, 'tpc-personal');
        expect(await bind(personal, 'tpc-personal')).toBe('kept');
        return seen;
      },
    };

    expect(await release('tpc-personal', racing)).toBe(false);
    expect((await rowNow()).topicId).toBe('tpc-personal');
  });

  it('leaves a conversation an acceptance or a Work set, and other topics', async () => {
    await trackedRow(personal, { topicId: 'tpc-personal' });
    await listOn(personal, 'tpc-personal');
    expect(await removeFrom('tpc-personal')).toBe(false);
    expect((await rowNow()).topicId).toBe('tpc-personal');

    await serverDB.update(scmChangeRequests).set({ topicId: null });
    await listOn(personal, 'tpc-work');
    await bind(personal, 'tpc-work');
    expect(await removeFrom('tpc-personal')).toBe(false);
    expect((await rowNow()).topicId).toBe('tpc-work');
  });

  it('does nothing for an untracked PR', async () => {
    expect(await removeFrom('tpc-personal')).toBe(false);
  });
});

describe('provider events and a link-held conversation', () => {
  it('keeps it through an event that resolves nothing, and yields to one that does', async () => {
    await trackedRow(personal);
    await listOn(personal, 'tpc-personal');
    await bind(personal, 'tpc-personal');

    // A `synchronize` with no acceptance or Work to go on.
    await trackedRow(personal);
    let row = await rowNow();
    expect(row.topicId).toBe('tpc-personal');
    expect(row.metadata.topicLink).toMatchObject({ topicId: 'tpc-personal' });

    // The agent registered the PR as Work in another conversation: it wins,
    // and the binding is no longer the link's to release.
    await trackedRow(personal, { topicId: 'tpc-work' });
    row = await rowNow();
    expect(row.topicId).toBe('tpc-work');
    expect(row.metadata.topicLink).toBeUndefined();
    expect(await removeFrom('tpc-personal')).toBe(false);
  });

  it('hands a link-held conversation over to an event that names the same one', async () => {
    await trackedRow(personal);
    await listOn(personal, 'tpc-personal');
    await bind(personal, 'tpc-personal');

    await trackedRow(personal, { topicId: 'tpc-personal' });
    const row = await rowNow();
    expect(row.topicId).toBe('tpc-personal');
    expect(row.metadata.topicLink).toBeUndefined();
    // Removing the PR no longer clears it: the next event would resolve it again.
    expect(await removeFrom('tpc-personal')).toBe(false);
  });

  describe('a Work registered after the link', () => {
    /** What `WorkModel` does after registering the agent's `gh pr create`. */
    const registerWork = async (topicId: string) => {
      await serverDB.insert(works).values({
        id: 'work-pr-46',
        resourceId: identifier,
        resourceType: 'github_pull_request',
        toolIdentifier: 'github',
        toolName: 'create_pull_request',
        type: 'external',
        userId: author,
        visibility: 'private',
      });
      await ScmChangeRequestModel.attachPullRequestWork(serverDB, {
        number: pasted.number,
        repoFullName: pasted.repoFullName,
        scope: personal,
        topicId,
        workId: 'work-pr-46',
      });
    };

    it('backs the same conversation, so removing the link no longer clears it', async () => {
      await trackedRow(personal);
      await listOn(personal, 'tpc-personal');
      await bind(personal, 'tpc-personal');

      await registerWork('tpc-personal');
      const row = await rowNow();
      expect(row.topicId).toBe('tpc-personal');
      expect(row.workId).toBe('work-pr-46');
      expect(row.metadata.topicLink).toBeUndefined();

      expect(await removeFrom('tpc-personal')).toBe(false);
      expect((await rowNow()).topicId).toBe('tpc-personal');
    });

    it('takes over a conversation only the link of another topic holds', async () => {
      await trackedRow(personal);
      await listOn(personal, 'tpc-personal');
      await bind(personal, 'tpc-personal');

      await registerWork('tpc-work');
      const row = await rowNow();
      expect(row.topicId).toBe('tpc-work');
      expect(row.metadata.topicLink).toBeUndefined();
      expect(row.metadata.routedBy).toBe('author');
    });

    it('leaves a conversation an acceptance or another Work set', async () => {
      await trackedRow(personal, { topicId: 'tpc-work' });

      await registerWork('tpc-personal');
      const row = await rowNow();
      expect(row.topicId).toBe('tpc-work');
      expect(row.workId).toBe('work-pr-46');
    });
  });

  describe('out of order', () => {
    const newer = new Date('2026-11-20T10:00:00Z');
    const older = new Date('2026-11-20T09:00:00Z');

    it("hands over to a stale delivery that finds the topic's own Work", async () => {
      await trackedRow(personal, {}, newer);
      await listOn(personal, 'tpc-personal');
      await bind(personal, 'tpc-personal');

      // A replayed delivery from before the link, resolving the Work the
      // topic's agent registered: the stored conversation stays, but it is
      // no longer only the link's.
      await trackedRow(personal, { topicId: 'tpc-personal' }, older);
      const row = await rowNow();
      expect(row.topicId).toBe('tpc-personal');
      expect(row.metadata.topicLink).toBeUndefined();
      expect(row.metadata.lastProviderEventAt).toBe(newer.toISOString());

      expect(await removeFrom('tpc-personal')).toBe(false);
      expect((await rowNow()).topicId).toBe('tpc-personal');
    });

    it("keeps the link's claim when a stale delivery names another conversation", async () => {
      await trackedRow(personal, {}, newer);
      await listOn(personal, 'tpc-personal');
      await bind(personal, 'tpc-personal');

      // A stale delivery cannot replace the stored conversation, so the slot
      // is still the link's and removing the PR still releases it.
      await trackedRow(personal, { topicId: 'tpc-work' }, older);
      const row = await rowNow();
      expect(row.topicId).toBe('tpc-personal');
      expect(row.metadata.topicLink).toMatchObject({ topicId: 'tpc-personal' });

      expect(await removeFrom('tpc-personal')).toBe(true);
      expect((await rowNow()).topicId).toBeNull();
    });
  });
});

describe('ScmChangeRequestModel.claimTopicFromLink', () => {
  it('refuses a row that was filled or re-routed after it was read', async () => {
    const row = await trackedRow(personal);
    await serverDB
      .update(scmChangeRequests)
      .set({ topicId: 'tpc-work' })
      .where(eq(scmChangeRequests.id, row.id));
    expect(
      await ScmChangeRequestModel.claimTopicFromLink(serverDB, row.id, personal, 'tpc-personal'),
    ).toBeNull();

    await serverDB
      .update(scmChangeRequests)
      .set({ topicId: null, workspaceId })
      .where(eq(scmChangeRequests.id, row.id));
    expect(
      await ScmChangeRequestModel.claimTopicFromLink(serverDB, row.id, personal, 'tpc-personal'),
    ).toBeNull();
    expect((await rowNow()).topicId).toBeNull();
  });

  it('does not take over a conversation a resolver set for the same topic', async () => {
    const row = await trackedRow(personal, { topicId: 'tpc-personal' });
    expect(
      await ScmChangeRequestModel.claimTopicFromLink(serverDB, row.id, personal, 'tpc-personal'),
    ).toBeNull();
    expect((await rowNow()).metadata.topicLink).toBeUndefined();
  });
});
