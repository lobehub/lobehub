// @vitest-environment node
import type { AcceptanceStatus } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptances, topics, users, verifyRuns, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AcceptanceModel } from '../acceptance';
import { ProjectModel } from '../project';
import { VerifyRunModel } from '../verifyRun';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'acceptance-test-user';
const otherUserId = 'acceptance-test-other';
const topicId = 'acceptance-test-topic';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values([{ id: topicId, userId }]);
});

afterEach(async () => {
  await serverDB.delete(verifyRuns);
  await serverDB.delete(acceptances);
  await serverDB.delete(topics);
  await serverDB.delete(users);
});

describe('AcceptanceModel', () => {
  it('ensureForSubject creates once and converges on the same row', async () => {
    const model = new AcceptanceModel(serverDB, userId);

    const first = await model.ensureForSubject('topic', topicId, {
      requirement: 'All checks green',
    });
    expect(first.status).toBe('pending');
    expect(first.requirement).toBe('All checks green');

    // Second ensure returns the SAME aggregate and never overwrites defaults.
    const second = await model.ensureForSubject('topic', topicId, {
      requirement: 'Different text',
    });
    expect(second.id).toBe(first.id);
    expect(second.requirement).toBe('All checks green');
  });

  it('ensureForSubject backfills an EMPTY requirement from a later round', async () => {
    const model = new AcceptanceModel(serverDB, userId);

    // First ingest omitted the requirement — the aggregate starts blank.
    const first = await model.ensureForSubject('topic', topicId);
    expect(first.requirement).toBeNull();

    // The first later round that supplies one fills the blank…
    const second = await model.ensureForSubject('topic', topicId, {
      requirement: 'Review UX polish ships end to end',
    });
    expect(second.id).toBe(first.id);
    expect(second.requirement).toBe('Review UX polish ships end to end');
    const persisted = await model.findBySubject('topic', topicId);
    expect(persisted?.requirement).toBe('Review UX polish ships end to end');

    // …and from then on the recorded statement is immutable again.
    const third = await model.ensureForSubject('topic', topicId, {
      requirement: 'Different text',
    });
    expect(third.requirement).toBe('Review UX polish ships end to end');
  });

  it('stores the project on the acceptance and becomes ungrouped when it is deleted', async () => {
    const projectModel = new ProjectModel(serverDB, userId);
    const project = await projectModel.create({ identifier: 'ACPT', name: 'Acceptance project' });
    const model = new AcceptanceModel(serverDB, userId);

    const first = await model.ensureForSubject('topic', topicId);
    expect(first.projectId).toBeNull();

    const grouped = await model.ensureForSubject('topic', topicId, { projectId: project.id });
    expect(grouped.projectId).toBe(project.id);
    expect((await model.findById(grouped.id))?.projectId).toBe(project.id);

    await projectModel.delete(project.id);
    expect((await model.findById(grouped.id))?.projectId).toBeNull();
  });

  it('files an acceptance under a project and takes it back out', async () => {
    const projectModel = new ProjectModel(serverDB, userId);
    const project = await projectModel.create({ identifier: 'MOVE', name: 'Move target' });
    const model = new AcceptanceModel(serverDB, userId);
    const acceptance = await model.ensureForSubject('topic', topicId);

    await model.update(acceptance.id, { projectId: project.id });
    expect((await model.findById(acceptance.id))?.projectId).toBe(project.id);

    // Ungrouping is the same write with a null — the aggregate itself stays put.
    await model.update(acceptance.id, { projectId: null });
    expect((await model.findById(acceptance.id))?.projectId).toBeNull();

    // Another user's model cannot re-file it: ownership scopes the update.
    await new AcceptanceModel(serverDB, otherUserId).update(acceptance.id, {
      projectId: project.id,
    });
    expect((await model.findById(acceptance.id))?.projectId).toBeNull();
  });

  it('keeps the first standalone display title and backfills one when initially absent', async () => {
    const model = new AcceptanceModel(serverDB, userId);
    const subjectId = 'standalone-external-delivery';

    const first = await model.ensureForSubject('standalone', subjectId);
    expect(first.metadata?.title).toBeUndefined();

    const titled = await model.ensureForSubject('standalone', subjectId, {
      metadata: { title: 'External delivery' },
    });
    expect(titled.metadata?.title).toBe('External delivery');

    const unchanged = await model.ensureForSubject('standalone', subjectId, {
      metadata: { title: 'Replacement title' },
    });
    expect(unchanged.metadata?.title).toBe('External delivery');
  });

  it('defaults visibility by scope: personal public, workspace private', async () => {
    const personal = new AcceptanceModel(serverDB, userId);
    const personalRow = await personal.ensureForSubject('topic', topicId);
    expect(personalRow.visibility).toBe('public');

    const [ws] = await serverDB
      .insert(workspaces)
      .values({ name: 'acceptance-vis-ws', primaryOwnerId: userId, slug: 'acceptance-vis-ws' })
      .returning();
    const scoped = new AcceptanceModel(serverDB, userId, ws.id);
    const scopedRow = await scoped.ensureForSubject('topic', topicId);
    expect(scopedRow.visibility).toBe('private');

    // The deliberate override survives the scope default.
    await scoped.update(scopedRow.id, { visibility: 'public' });
    expect((await scoped.findById(scopedRow.id))?.visibility).toBe('public');
  });

  it('scopes subject lookup per owner', async () => {
    const model = new AcceptanceModel(serverDB, userId);
    await model.ensureForSubject('topic', topicId);

    const otherModel = new AcceptanceModel(serverDB, otherUserId);
    expect(await otherModel.findBySubject('topic', topicId)).toBeUndefined();
  });

  it('shares workspace execution policies without exposing private reports', async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'policy-ws', primaryOwnerId: userId, slug: 'policy-ws' })
      .returning();
    const creatorModel = new AcceptanceModel(serverDB, userId, workspace.id);
    const acceptance = await creatorModel.ensureForSubject('topic', topicId, {
      config: { enabled: true },
    });
    const collaboratorModel = new AcceptanceModel(serverDB, otherUserId, workspace.id);

    expect(await collaboratorModel.findBySubject('topic', topicId)).toBeUndefined();
    expect(await collaboratorModel.findPolicyBySubject('topic', topicId)).toMatchObject({
      id: acceptance.id,
    });
    expect(await collaboratorModel.findPolicyById(acceptance.id)).toMatchObject({
      id: acceptance.id,
    });
    await collaboratorModel.updatePolicy(acceptance.id, { requirement: 'Shared task contract' });
    await collaboratorModel.updatePolicyStatus(acceptance.id, 'verifying');
    expect((await creatorModel.findBySubject('topic', topicId))?.requirement).toBe(
      'Shared task contract',
    );
    expect((await creatorModel.findBySubject('topic', topicId))?.status).toBe('verifying');

    expect(
      await new AcceptanceModel(serverDB, otherUserId).findPolicyBySubject('topic', topicId),
    ).toBeUndefined();
  });

  it('reads many subjects statuses in one call, however old they are', async () => {
    const model = new AcceptanceModel(serverDB, userId);
    const olderTopicId = 'acceptance-test-topic-older';
    await serverDB.insert(topics).values([{ id: olderTopicId, userId }]);

    const older = await model.ensureForSubject('topic', olderTopicId);
    await model.updateStatus(older.id, 'accepted');
    const newer = await model.ensureForSubject('topic', topicId);
    await model.updateStatus(newer.id, 'delivered');

    // The recency-capped feed is what this exists to replace: asked about a
    // subject, it answers about that subject, not about the newest N rows.
    const statuses = await model.listStatusesBySubjects('topic', [olderTopicId, topicId]);

    expect(Object.fromEntries(statuses.map((row) => [row.subjectId, row.status]))).toEqual({
      [olderTopicId]: 'accepted',
      [topicId]: 'delivered',
    });
  });

  it('omits subjects with no acceptance, and never crosses owners', async () => {
    const model = new AcceptanceModel(serverDB, userId);
    await model.ensureForSubject('topic', topicId);

    await expect(model.listStatusesBySubjects('topic', ['no-such-subject'])).resolves.toEqual([]);
    await expect(model.listStatusesBySubjects('topic', [])).resolves.toEqual([]);
    // Same subject id, different owner — must not leak.
    await expect(
      new AcceptanceModel(serverDB, otherUserId).listStatusesBySubjects('topic', [topicId]),
    ).resolves.toEqual([]);
    // Right id, wrong subject type.
    await expect(model.listStatusesBySubjects('task', [topicId])).resolves.toEqual([]);
  });

  it('updateStatus stamps completedAt only on user-terminal statuses', async () => {
    const model = new AcceptanceModel(serverDB, userId);
    const row = await model.ensureForSubject('topic', topicId);

    await model.updateStatus(row.id, 'delivered');
    expect((await model.findById(row.id))?.completedAt).toBeNull();

    await model.updateStatus(row.id, 'accepted');
    expect((await model.findById(row.id))?.completedAt).toBeInstanceOf(Date);

    await model.updateStatus(row.id, 'closed');
    expect((await model.findById(row.id))?.completedAt).toBeInstanceOf(Date);

    // A new round re-opening the loop clears the completion stamp.
    await model.updateStatus(row.id, 'verifying');
    expect((await model.findById(row.id))?.completedAt).toBeNull();
  });

  describe('queryPage', () => {
    /** Fixed, strictly-decreasing createdAt so the keyset order is deterministic. */
    const seed = async (
      rows: { minutesAgo: number; status: 'accepted' | 'closed' | 'delivered' | 'verifying' }[],
    ) => {
      const base = Date.UTC(2026, 7, 30, 12, 0, 0);
      await serverDB.insert(acceptances).values(
        rows.map((row, index) => ({
          createdAt: new Date(base - row.minutesAgo * 60_000),
          status: row.status,
          subjectId: `page-subject-${index}`,
          subjectType: 'standalone' as const,
          userId,
        })),
      );
    };

    const pageThrough = async (
      model: AcceptanceModel,
      limit: number,
      statuses?: AcceptanceStatus[],
    ) => {
      const seen: string[] = [];
      let cursor: string | undefined;
      // Bounded so a cursor that fails to advance fails the test instead of hanging.
      for (let page = 0; page < 10; page += 1) {
        const result = await model.queryPage({ cursor, limit, statuses });
        seen.push(...result.items.map((item) => item.subjectId));
        if (!result.nextCursor) return seen;
        cursor = result.nextCursor;
      }
      throw new Error('queryPage never reached the end of the feed');
    };

    it('walks the whole feed newest-first, with no row repeated or skipped', async () => {
      const model = new AcceptanceModel(serverDB, userId);
      await seed(
        [0, 1, 2, 3, 4].map((minutesAgo) => ({ minutesAgo, status: 'delivered' as const })),
      );

      const seen = await pageThrough(model, 2);

      expect(seen).toEqual([
        'page-subject-0',
        'page-subject-1',
        'page-subject-2',
        'page-subject-3',
        'page-subject-4',
      ]);
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('reports no next cursor on an exactly-full final page', async () => {
      // The classic off-by-one: `rows.length === limit` must not advertise a
      // further page, or the scroll spins on an empty fetch forever.
      const model = new AcceptanceModel(serverDB, userId);
      await seed([0, 1].map((minutesAgo) => ({ minutesAgo, status: 'delivered' as const })));

      expect(await model.queryPage({ limit: 2 })).toMatchObject({ nextCursor: null });
    });

    it('splits in-progress from completed in the QUERY, so a page is a full page', async () => {
      const model = new AcceptanceModel(serverDB, userId);
      await seed([
        { minutesAgo: 0, status: 'accepted' },
        { minutesAgo: 1, status: 'delivered' },
        { minutesAgo: 2, status: 'closed' },
        { minutesAgo: 3, status: 'verifying' },
      ]);

      const inProgress: AcceptanceStatus[] = ['delivered', 'verifying'];
      const completed: AcceptanceStatus[] = ['accepted', 'closed'];

      await expect(pageThrough(model, 10, inProgress)).resolves.toEqual([
        'page-subject-1',
        'page-subject-3',
      ]);
      await expect(pageThrough(model, 10, completed)).resolves.toEqual([
        'page-subject-0',
        'page-subject-2',
      ]);
      // A page of one still has to hand back the rest of its own split.
      await expect(pageThrough(model, 1, inProgress)).resolves.toEqual([
        'page-subject-1',
        'page-subject-3',
      ]);
    });

    it('never pages across owners', async () => {
      await seed([{ minutesAgo: 0, status: 'delivered' }]);

      await expect(
        new AcceptanceModel(serverDB, otherUserId).queryPage({ limit: 10 }),
      ).resolves.toMatchObject({ items: [], nextCursor: null });
    });

    it('treats a malformed cursor as the start of the feed', async () => {
      const model = new AcceptanceModel(serverDB, userId);
      await seed([{ minutesAgo: 0, status: 'delivered' }]);

      for (const cursor of [
        'garbage',
        // Well-formed shape, unusable id: comparing it against a uuid column
        // makes Postgres raise 22P02, turning bad client input into a 500.
        '2026-08-30T12:00:00.000Z__not-a-uuid',
        'not-a-date__00000000-0000-4000-8000-000000000000',
      ]) {
        const { items } = await model.queryPage({ cursor, limit: 10 });
        expect(items.map((item) => item.subjectId)).toEqual(['page-subject-0']);
      }
    });
  });

  it('resolves a private workspace row only for the scope it is bound to', async () => {
    // The write path binds a service to the acceptance's OWNER precisely because
    // of this: `acceptances` carries a `visibility` column, so the ownership
    // predicate narrows PRIVATE rows to the bound user — and a workspace
    // acceptance is private by default. Binding to the acting workspace owner
    // instead makes every write miss the row and answer NOT_FOUND, after
    // authorization has already said yes.
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'scope-ws', primaryOwnerId: otherUserId, slug: 'scope-ws' })
      .returning();

    const creatorModel = new AcceptanceModel(serverDB, userId, workspace.id);
    const acceptance = await creatorModel.ensureForSubject('topic', topicId);
    expect(acceptance.visibility).toBe('private');

    // Bound to the acting owner: invisible, and a write silently changes nothing.
    const actorScoped = new AcceptanceModel(serverDB, otherUserId, workspace.id);
    expect(await actorScoped.findById(acceptance.id)).toBeUndefined();
    await actorScoped.updateStatus(acceptance.id, 'accepted');
    expect((await creatorModel.findById(acceptance.id))?.status).not.toBe('accepted');

    // Bound to the row's owner: found, and the write lands.
    await creatorModel.updateStatus(acceptance.id, 'accepted');
    expect((await creatorModel.findById(acceptance.id))?.status).toBe('accepted');
  });

  it('findById reads a malformed uuid as not-found instead of aborting in Postgres', async () => {
    // Chat autolinkers glue trailing CJK punctuation onto shared links, so the
    // route param can arrive as `<uuid>（本轮` — 22P02 (→ 500) before the guard.
    const model = new AcceptanceModel(serverDB, userId);
    const row = await model.ensureForSubject('topic', topicId);

    await expect(model.findById(`${row.id}（本轮`)).resolves.toBeUndefined();
    await expect(model.findById('not-a-uuid')).resolves.toBeUndefined();

    const runModel = new VerifyRunModel(serverDB, userId);
    await expect(runModel.findById(`${row.id}（本轮`)).resolves.toBeUndefined();
  });
});

describe('VerifyRunModel acceptance chain', () => {
  it('attachToAcceptance assigns sequential round indexes', async () => {
    const acceptanceModel = new AcceptanceModel(serverDB, userId);
    const acceptance = await acceptanceModel.ensureForSubject('topic', topicId);

    const runModel = new VerifyRunModel(serverDB, userId);
    const first = await runModel.create({ source: 'agent-testing', title: 'round 1' });
    const second = await runModel.create({ source: 'agent-testing', title: 'round 2' });

    const attached1 = await runModel.attachToAcceptance(first.id, acceptance.id);
    const attached2 = await runModel.attachToAcceptance(second.id, acceptance.id);
    expect(attached1.roundIndex).toBe(1);
    expect(attached2.roundIndex).toBe(2);

    const rounds = await runModel.listByAcceptance(acceptance.id);
    expect(rounds.map((r) => r.title)).toEqual(['round 1', 'round 2']);
  });

  it('run visibility: scope default, umbrella inheritance on attach, and cascade', async () => {
    // Scope defaults mirror acceptances: personal → public, workspace → private.
    const personal = new VerifyRunModel(serverDB, userId);
    const personalRun = await personal.create({ source: 'agent-testing' });
    expect(personalRun.visibility).toBe('public');

    const [ws] = await serverDB
      .insert(workspaces)
      .values({ name: 'verify-vis-ws', primaryOwnerId: userId, slug: 'verify-vis-ws' })
      .returning();
    const scoped = new VerifyRunModel(serverDB, userId, ws.id);
    const scopedRun = await scoped.create({ source: 'agent-testing' });
    expect(scopedRun.visibility).toBe('private');

    // Attaching inherits the aggregate's visibility (a private umbrella hides
    // the new round's own report URL too).
    const acceptanceModel = new AcceptanceModel(serverDB, userId);
    const acceptance = await acceptanceModel.ensureForSubject('topic', topicId);
    await acceptanceModel.update(acceptance.id, { visibility: 'private' });
    const attached = await personal.attachToAcceptance(personalRun.id, acceptance.id, 'private');
    expect(attached.visibility).toBe('private');

    // The aggregate-level flip re-stamps every chained round.
    await acceptanceModel.update(acceptance.id, { visibility: 'public' });
    await personal.setVisibilityByAcceptance(acceptance.id, 'public');
    expect((await personal.findById(personalRun.id))?.visibility).toBe('public');
  });

  it('setDecision records the user verdict with its detail', async () => {
    const acceptanceModel = new AcceptanceModel(serverDB, userId);
    const acceptance = await acceptanceModel.ensureForSubject('topic', topicId);

    const runModel = new VerifyRunModel(serverDB, userId);
    const run = await runModel.create({ source: 'agent-testing' });
    await runModel.attachToAcceptance(run.id, acceptance.id);

    await runModel.setDecision(run.id, 'reject', {
      comment: 'dark mode needs a screenshot',
      decidedAt: new Date().toISOString(),
      decidedBy: userId,
    });

    const found = await runModel.findById(run.id);
    expect(found?.userDecision).toBe('reject');
    expect(found?.decisionDetail?.comment).toBe('dark mode needs a screenshot');
  });

  it('rejects attaching a run that is not owned by the caller', async () => {
    const acceptanceModel = new AcceptanceModel(serverDB, userId);
    const acceptance = await acceptanceModel.ensureForSubject('topic', topicId);

    const otherRun = await new VerifyRunModel(serverDB, otherUserId).create({
      source: 'agent-testing',
    });

    await expect(
      new VerifyRunModel(serverDB, userId).attachToAcceptance(otherRun.id, acceptance.id),
    ).rejects.toThrow('not found');
  });
});
