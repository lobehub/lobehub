// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { deleteTestUsers } from '../../core/testCleanup';
import { ProjectRepository } from '../../repositories/project';
import {
  acceptanceComments,
  acceptanceReviewMarks,
  acceptances,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AcceptanceReviewModel } from '../acceptanceReview';
import { ProjectSiteModel } from '../projectReview';

const serverDB: LobeChatDatabase = await getTestDB();

const owner = 'acceptance-replies-owner';
const reviewer = 'acceptance-replies-reviewer';
const workspaceId = 'acceptance-replies-workspace';

const model = new AcceptanceReviewModel(serverDB);

let siteId: string;
let projectId: string;
let acceptanceId: string;

const markInput = (clientId: string, content = 'Cards are too tight') => ({
  clientId,
  content,
  kind: 'region' as const,
  rectDocument: { height: 160, width: 384, x: 448, y: 1294 },
  rectViewport: { height: 160, width: 384, x: 448, y: 494 },
  routeKey: '/notebook',
  scroll: { x: 0, y: 800 },
  url: 'https://preview.example.com/notebook',
  viewport: { dpr: 2, height: 800, width: 1280 },
});

const draftOf = (userId: string) => model.createDraft({ projectId, siteId, userId });

const submittedReviewOf = async (userId: string) => {
  const review = await draftOf(userId);
  await model.addMark(review.id, markInput('a'));
  await model.markSubmitted(review.id);
  return review;
};

const markIdsOf = async (reviewId: string) => {
  const rows = await serverDB
    .select({ id: acceptanceReviewMarks.id })
    .from(acceptanceReviewMarks)
    .where(eq(acceptanceReviewMarks.reviewId, reviewId));
  return rows.map((row) => row.id);
};

beforeEach(async () => {
  await deleteTestUsers(serverDB);
  await serverDB.insert(users).values([{ id: owner }, { id: reviewer }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: owner, slug: 'acceptance-replies' });

  const project = await new ProjectRepository(serverDB, owner).create({
    identifier: 'FNT',
    name: 'Fieldnotes',
  });
  projectId = project.id;
  const site = await new ProjectSiteModel(serverDB).create({
    name: 'Preview',
    origins: ['https://preview.example.com'],
    projectId,
  });
  siteId = site.id;

  const [acceptance] = await serverDB
    .insert(acceptances)
    .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: owner })
    .returning();
  acceptanceId = acceptance.id;
});

afterEach(async () => {
  await deleteTestUsers(serverDB);
  await serverDB.delete(workspaces);
});

describe('AcceptanceReviewModel.createDraft without a project', () => {
  it('stores a draft that belongs to no project', async () => {
    const draft = await model.createDraft({ siteId, userId: reviewer });

    expect(draft.projectId).toBeNull();
  });
});

describe('AcceptanceReviewModel.revertToDraft', () => {
  it('reopens a submitted review so the reviewer can keep marking', async () => {
    const review = await submittedReviewOf(reviewer);

    const reverted = await model.revertToDraft(review.id);

    expect(reverted).toMatchObject({ id: review.id, status: 'draft', submittedAt: null });
    // Reopening frees the draft slot, so marking resumes on the same review.
    expect((await model.addMark(review.id, markInput('b')))?.seq).toBe(2);
  });

  it('leaves a review that was never submitted alone', async () => {
    const review = await draftOf(reviewer);

    expect(await model.revertToDraft(review.id)).toBeUndefined();
    expect((await model.findById(review.id))?.status).toBe('draft');
  });
});

describe('AcceptanceReviewModel.discard on a submitted review', () => {
  it('refuses to discard and keeps the marks a reviewer already sent', async () => {
    const review = await submittedReviewOf(reviewer);
    const marks = await markIdsOf(review.id);

    expect(await model.discard(review.id)).toBeUndefined();
    expect((await model.findById(review.id))?.status).toBe('submitted');
    expect(await markIdsOf(review.id)).toEqual(marks);
  });
});

describe('AcceptanceReviewModel.findMark', () => {
  it('finds a mark of the review it belongs to and nothing across reviews', async () => {
    const review = await draftOf(reviewer);
    const other = await draftOf(owner);
    const mark = await model.addMark(review.id, markInput('a'));

    expect((await model.findMark(review.id, mark!.id))?.clientId).toBe('a');
    expect(await model.findMark(other.id, mark!.id)).toBeUndefined();
  });
});

describe('AcceptanceReviewModel.countMarks', () => {
  it('counts without querying when there is nothing to count', async () => {
    expect((await model.countMarks([])).size).toBe(0);
  });

  it('counts the marks of every review in one round trip', async () => {
    const busy = await draftOf(reviewer);
    const quiet = await draftOf(owner);
    await model.addMark(busy.id, markInput('a'));
    await model.addMark(busy.id, markInput('b'));

    const counts = await model.countMarks([busy.id, quiet.id]);

    expect(counts.get(busy.id)).toBe(2);
    expect(counts.get(quiet.id)).toBeUndefined();
  });
});

describe('AcceptanceReviewModel replies', () => {
  it('returns the stored reply and keeps a retried clientId to one row', async () => {
    const review = await draftOf(reviewer);
    const mark = await model.addMark(review.id, markInput('a'));

    const reply = await model.addReply(acceptanceId, mark!.id, {
      authorUserId: reviewer,
      clientId: 'reply-1',
      content: 'Agreed',
    });
    const retried = await model.addReply(acceptanceId, mark!.id, {
      authorUserId: reviewer,
      clientId: 'reply-1',
      content: 'Agreed',
    });

    expect(retried?.id).toBe(reply!.id);
    expect(await model.listReplies(mark!.id)).toHaveLength(1);
  });

  it('copies the workspace of a reply and leaves a personal one unscoped', async () => {
    const review = await draftOf(reviewer);
    const mark = await model.addMark(review.id, markInput('a'));

    const personal = await model.addReply(acceptanceId, mark!.id, {
      authorUserId: reviewer,
      clientId: 'personal',
      content: 'Personal',
    });
    const inWorkspace = await model.addReply(acceptanceId, mark!.id, {
      authorUserId: reviewer,
      clientId: 'in-workspace',
      content: 'Workspace',
      workspaceId,
    });

    expect(personal?.workspaceId).toBeNull();
    expect(inWorkspace?.workspaceId).toBe(workspaceId);
  });

  it('counts only live replies, per mark', async () => {
    const review = await draftOf(reviewer);
    const first = await model.addMark(review.id, markInput('a'));
    const second = await model.addMark(review.id, markInput('b'));

    await model.addReply(acceptanceId, first!.id, {
      authorUserId: reviewer,
      clientId: 'one',
      content: 'One',
    });
    const gone = await model.addReply(acceptanceId, first!.id, {
      authorUserId: reviewer,
      clientId: 'two',
      content: 'Two',
    });
    await serverDB
      .update(acceptanceComments)
      .set({ deletedAt: new Date() })
      .where(eq(acceptanceComments.id, gone!.id));

    expect((await model.countReplies([])).size).toBe(0);
    const counts = await model.countReplies([first!.id, second!.id]);
    expect(counts.get(first!.id)).toBe(1);
    expect(counts.get(second!.id)).toBeUndefined();
  });

  it('lists the live replies of a mark oldest first and hides deleted ones', async () => {
    const review = await draftOf(reviewer);
    const mark = await model.addMark(review.id, markInput('a'));

    const earlier = await model.addReply(acceptanceId, mark!.id, {
      authorUserId: reviewer,
      clientId: 'earlier',
      content: 'Earlier',
    });
    const later = await model.addReply(acceptanceId, mark!.id, {
      authorUserId: reviewer,
      clientId: 'later',
      content: 'Later',
    });
    await serverDB
      .update(acceptanceComments)
      .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(acceptanceComments.id, earlier!.id));
    await serverDB
      .update(acceptanceComments)
      .set({ createdAt: new Date('2026-01-02T00:00:00Z') })
      .where(eq(acceptanceComments.id, later!.id));

    expect((await model.listReplies(mark!.id)).map((row) => row.content)).toEqual([
      'Earlier',
      'Later',
    ]);

    await serverDB
      .update(acceptanceComments)
      .set({ deletedAt: new Date() })
      .where(eq(acceptanceComments.id, earlier!.id));

    expect((await model.listReplies(mark!.id)).map((row) => row.content)).toEqual(['Later']);
  });

  it('collects every reply id of an acceptance, and no global comment', async () => {
    const review = await draftOf(reviewer);
    const mark = await model.addMark(review.id, markInput('a'));
    const reply = await model.addReply(acceptanceId, mark!.id, {
      authorUserId: reviewer,
      clientId: 'reply',
      content: 'Reply',
    });
    const [global] = await serverDB
      .insert(acceptanceComments)
      .values({ acceptanceId, authorUserId: owner, clientId: 'global', content: 'Global' })
      .returning();

    const ids = await model.listReplyIds(acceptanceId);

    expect(ids.has(reply!.id)).toBe(true);
    expect(ids.has(global.id)).toBe(false);
  });
});

describe('AcceptanceReviewModel.addMark failures', () => {
  it('surfaces a write failure instead of reporting a saved mark', async () => {
    const review = await draftOf(reviewer);

    await expect(
      model.addMark(review.id, { ...markInput('broken'), content: null as unknown as string }),
    ).rejects.toThrow();
    expect(await markIdsOf(review.id)).toEqual([]);
    // The transaction rolled back, so the numbering the caller sees is unchanged.
    expect((await model.findById(review.id))?.lastMarkSeq).toBe(0);
  });
});

describe('AcceptanceReviewModel reply linkage', () => {
  it('keeps replies of one acceptance apart from another', async () => {
    const review = await draftOf(reviewer);
    const mark = await model.addMark(review.id, markInput('a'));
    await model.addReply(acceptanceId, mark!.id, {
      authorUserId: reviewer,
      clientId: 'only',
      content: 'Only',
    });
    const [other] = await serverDB
      .insert(acceptances)
      .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: owner })
      .returning();

    expect(await model.listReplyIds(other.id)).toEqual(new Set());
    expect(
      await serverDB
        .select({ id: acceptanceComments.id })
        .from(acceptanceComments)
        .where(
          and(
            eq(acceptanceComments.acceptanceId, acceptanceId),
            eq(acceptanceComments.reviewMarkId, mark!.id),
          ),
        ),
    ).toHaveLength(1);
  });
});
