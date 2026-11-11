// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptances, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AcceptanceReviewModel } from '../acceptanceReview';

const serverDB: LobeChatDatabase = await getTestDB();

const owner = 'acceptance-review-owner';
const reviewer = 'acceptance-review-reviewer';
const model = new AcceptanceReviewModel(serverDB);

let siteAcceptanceId: string;

const page = {
  pageTitle: 'Fieldnotes',
  pageUrl: 'https://preview.example.com/notebook?tab=1',
  route: '/notebook',
};

const markInput = (clientId: string, content = 'Cards are too tight') => ({
  clientId,
  content,
  kind: 'region' as const,
  pageUrl: page.pageUrl,
  rectDocument: { height: 160, width: 384, x: 448, y: 1294 },
  rectViewport: { height: 160, width: 384, x: 448, y: 494 },
  route: page.route,
  scroll: { x: 0, y: 800 },
  viewport: { dpr: 2, height: 800, width: 1280 },
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: owner }, { id: reviewer }]);
  const [site] = await serverDB
    .insert(acceptances)
    .values({ subjectId: randomUUID(), subjectType: 'site', userId: owner })
    .returning();
  siteAcceptanceId = site.id;
});

describe('AcceptanceReviewModel drafts', () => {
  it('keeps one draft per author per site acceptance', async () => {
    const first = await model.createDraft({
      acceptanceId: siteAcceptanceId,
      authorUserId: reviewer,
      ...page,
    });

    await expect(
      model.createDraft({ acceptanceId: siteAcceptanceId, authorUserId: reviewer, ...page }),
    ).rejects.toThrow();

    const other = await model.createDraft({
      acceptanceId: siteAcceptanceId,
      authorUserId: owner,
      ...page,
    });
    expect(other.id).not.toBe(first.id);
    expect((await model.findDraft(siteAcceptanceId, reviewer))?.id).toBe(first.id);
  });

  it('frees the draft slot once the draft is discarded', async () => {
    const first = await model.createDraft({
      acceptanceId: siteAcceptanceId,
      authorUserId: reviewer,
      ...page,
    });
    await model.discard(first.id);

    expect(await model.findDraft(siteAcceptanceId, reviewer)).toBeUndefined();
    const second = await model.createDraft({
      acceptanceId: siteAcceptanceId,
      authorUserId: reviewer,
      ...page,
    });
    expect(second.status).toBe('draft');
  });
});

describe('AcceptanceReviewModel marks', () => {
  it('numbers marks in order and never reuses a deleted number', async () => {
    const review = await model.createDraft({
      acceptanceId: siteAcceptanceId,
      authorUserId: reviewer,
      ...page,
    });
    const one = await model.addMark(review.id, markInput('a'));
    const two = await model.addMark(review.id, markInput('b'));
    await model.deleteMark(review.id, two.id);
    const three = await model.addMark(review.id, markInput('c'));

    expect([one.seq, two.seq, three.seq]).toEqual([1, 2, 3]);
    expect((await model.listMarks(review.id)).map((mark) => mark.seq)).toEqual([1, 3]);
  });

  it('returns the stored mark when the same clientId is retried', async () => {
    const review = await model.createDraft({
      acceptanceId: siteAcceptanceId,
      authorUserId: reviewer,
      ...page,
    });
    const first = await model.addMark(review.id, markInput('same'));
    const retried = await model.addMark(review.id, markInput('same', 'changed on retry'));

    expect(retried.id).toBe(first.id);
    expect(retried.content).toBe('Cards are too tight');
    expect(await model.listMarks(review.id)).toHaveLength(1);
  });

  it('stores the raw geometry as given', async () => {
    const review = await model.createDraft({
      acceptanceId: siteAcceptanceId,
      authorUserId: reviewer,
      ...page,
    });
    await model.addMark(review.id, markInput('geo'));
    const [stored] = await model.listMarks(review.id);

    expect(stored.rectDocument).toEqual({ height: 160, width: 384, x: 448, y: 1294 });
    expect(stored.scroll).toEqual({ x: 0, y: 800 });
    expect(stored.viewport).toEqual({ dpr: 2, height: 800, width: 1280 });
  });

  it('updates content only while the review is a draft', async () => {
    const review = await model.createDraft({
      acceptanceId: siteAcceptanceId,
      authorUserId: reviewer,
      ...page,
    });
    const mark = await model.addMark(review.id, markInput('edit'));
    const updated = await model.updateMark(review.id, mark.id, { content: 'Line height 1.9' });
    expect(updated?.content).toBe('Line height 1.9');

    await model.markSubmitted(review.id, { title: 'Fieldnotes · 1 marks' });
    expect(await model.updateMark(review.id, mark.id, { content: 'late edit' })).toBeUndefined();
    expect(await model.deleteMark(review.id, mark.id)).toBe(false);
  });
});

describe('AcceptanceReviewModel listing', () => {
  it('lists only submitted reviews, newest first, filtered by route', async () => {
    const draft = await model.createDraft({
      acceptanceId: siteAcceptanceId,
      authorUserId: reviewer,
      ...page,
    });
    const older = await model.createDraft({
      acceptanceId: siteAcceptanceId,
      authorUserId: owner,
      ...page,
    });
    await model.markSubmitted(older.id, { title: 'older' });
    const elsewhere = await model.createDraft({
      acceptanceId: siteAcceptanceId,
      authorUserId: owner,
      ...page,
      route: '/settings',
    });
    await model.markSubmitted(elsewhere.id, { title: 'elsewhere' });
    const newer = await model.createDraft({
      acceptanceId: siteAcceptanceId,
      authorUserId: owner,
      ...page,
    });
    await model.markSubmitted(newer.id, { title: 'newer' });

    const onPage = await model.listSubmitted(siteAcceptanceId, '/notebook');
    expect(onPage.map((review) => review.id)).toEqual([newer.id, older.id]);
    expect(onPage.map((review) => review.id)).not.toContain(draft.id);
    expect(await model.listSubmitted(siteAcceptanceId)).toHaveLength(3);
  });

  it('finds a review from its delivery acceptance', async () => {
    const review = await model.createDraft({
      acceptanceId: siteAcceptanceId,
      authorUserId: reviewer,
      ...page,
    });
    const [delivery] = await serverDB
      .insert(acceptances)
      .values({ subjectId: randomUUID(), subjectType: 'task', userId: reviewer })
      .returning();
    await model.linkDelivery(review.id, { deliveryAcceptanceId: delivery.id, taskId: null });

    expect((await model.findByDeliveryAcceptance(delivery.id))?.id).toBe(review.id);
  });
});
