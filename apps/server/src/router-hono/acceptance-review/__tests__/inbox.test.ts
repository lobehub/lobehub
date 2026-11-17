// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  acceptanceReviews,
  acceptances,
  projectMembers,
  tasks,
  verifyCheckResults,
  verifyRuns,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceReviewModel } from '@/database/models/acceptanceReview';
import { ProjectModel } from '@/database/models/project';
import { ProjectMemberModel } from '@/database/models/projectReview';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';
import { ProjectReviewService } from '@/server/services/projectReview';

let serverDB: LobeChatDatabase;

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => serverDB }));
vi.mock('@/libs/oidc-provider/jwt', () => ({
  verifyAcceptanceExtensionJWT: async (token: string) => {
    const [kind, userId] = token.split('|');
    if (kind !== 'ext' || !userId) throw new Error('invalid');
    return { userId };
  },
  verifyAcceptanceReviewJWT: async () => {
    throw new Error('not used');
  },
}));
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: vi.fn() },
}));

const { default: app } = await import('../index');

const INBOX = 'http://localhost/api/acceptance-review/v1/extension/inbox';
const ORIGIN = 'https://fieldnotes.app';

let ownerId: string;
let memberId: string;
let workspaceId: string;
let projectId: string;
let site: { acceptanceId: string | null; id: string };
let model: AcceptanceReviewModel;

const inbox = async (userId: string) => {
  const response = await app.request(INBOX, {
    headers: { authorization: `Bearer ext|${userId}` },
  });
  return { body: await response.json(), status: response.status };
};

const mark = (clientId: string, content: string, path = '/notebook') => ({
  clientId,
  content,
  kind: 'region' as const,
  rectDocument: { height: 160, width: 384, x: 448, y: 1294 },
  rectViewport: { height: 160, width: 384, x: 448, y: 494 },
  routeKey: path,
  scroll: { x: 0, y: 800 },
  url: `${ORIGIN}${path}`,
  viewport: { dpr: 2, height: 800, width: 1280 },
});

const submitRound = async (
  userId: string,
  contents: string[],
  delivery?: { status: string; verdicts?: ('failed' | 'passed' | 'uncertain')[] },
) => {
  const review = await model.createDraft({ projectId, siteId: site.id, userId, workspaceId });
  const marks = [];
  for (const [index, content] of contents.entries())
    marks.push((await model.addMark(review.id, mark(`m${index}`, content, `/page-${index}`)))!);
  await model.markSubmitted(review.id);
  if (!delivery) return { marks, reviewId: review.id };
  const taskId = randomUUID();
  await serverDB.insert(tasks).values({
    createdByUserId: userId,
    id: taskId,
    identifier: `T-${taskId.slice(0, 6)}`,
    instruction: 'review round',
    seq: 1,
    status: 'completed',
  });
  await model.linkTask(review.id, taskId);
  const [row] = await serverDB
    .insert(acceptances)
    .values({
      projectId,
      status: delivery.status as never,
      subjectId: taskId,
      subjectType: 'task',
      userId,
      visibility: 'private',
      workspaceId,
    })
    .returning();
  const [run] = await serverDB
    .insert(verifyRuns)
    .values({
      acceptanceId: row.id,
      plan: marks.map((item, index) => ({
        description: 'check',
        id: item.id,
        index,
        onFail: 'manual' as const,
        required: true,
        title: `#${index + 1}`,
        verifierConfig: {},
        verifierType: 'agent' as const,
      })),
      planConfirmedAt: new Date(),
      roundIndex: 1,
      userId,
      workspaceId,
    })
    .returning();
  const verdicts = delivery.verdicts ?? [];
  if (verdicts.length)
    await serverDB.insert(verifyCheckResults).values(
      verdicts.map((verdict, index) => ({
        checkItemId: marks[index].id,
        status: verdict === 'passed' ? ('passed' as const) : ('failed' as const),
        userId,
        verdict,
        verifierType: 'agent' as const,
        verifyRunId: run.id,
        workspaceId,
      })),
    );
  return { deliveryId: row.id, marks, reviewId: review.id, run };
};

beforeEach(async () => {
  serverDB = await getTestDB();
  model = new AcceptanceReviewModel(serverDB);
  ownerId = await createTestUser(serverDB);
  memberId = await createTestUser(serverDB);
  const [workspace] = await serverDB
    .insert(workspaces)
    .values({ name: 'Fieldnotes', primaryOwnerId: ownerId, slug: ownerId })
    .returning();
  workspaceId = workspace.id;
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { role: 'member', userId: memberId, workspaceId },
  ]);
  projectId = (
    await new ProjectModel(serverDB, ownerId, workspaceId).create({
      identifier: 'SITE',
      name: 'Site',
    })
  ).id;
  await new ProjectMemberModel(serverDB).add({ projectId, role: 'member', userId: memberId });
  site = await new ProjectReviewService(serverDB, ownerId).createSite(projectId, {
    name: 'Marketing site',
    origins: [ORIGIN],
  });
});

afterEach(async () => {
  await cleanupTestUser(serverDB, memberId);
  await cleanupTestUser(serverDB, ownerId);
});

describe('GET /extension/inbox', () => {
  it('lists a delivered round with what the Agent concluded', async () => {
    const round = await submitRound(memberId, ['Cards are too tight', 'Title too small'], {
      status: 'delivered',
      verdicts: ['passed', 'uncertain'],
    });

    const { body, status } = await inbox(memberId);

    expect(status).toBe(200);
    expect(body.items).toEqual([
      {
        deliveredAt: round.run!.updatedAt.toISOString(),
        marks: 2,
        name: 'Cards are too tight',
        notPassed: 1,
        passed: 1,
        phase: 'delivered',
        reviewId: round.reviewId,
        round: 1,
        site: { id: site.id, name: 'Marketing site' },
        submittedAt: expect.any(String),
        url: `${ORIGIN}/page-0`,
      },
    ]);
  });

  it('counts marks without an Agent result as not passed', async () => {
    await submitRound(memberId, ['a', 'b', 'c'], { status: 'delivered', verdicts: ['passed'] });

    const { body } = await inbox(memberId);

    expect(body.items[0]).toMatchObject({ marks: 3, notPassed: 2, passed: 1 });
  });

  it('shows a round without a delivery as running, with no delivered time', async () => {
    await submitRound(memberId, ['Spacing']);

    const { body } = await inbox(memberId);

    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ marks: 1, notPassed: 1, passed: 0, phase: 'running' });
    expect(body.items[0].deliveredAt).toBeUndefined();
  });

  it('shows a delivery that will never deliver as failed', async () => {
    await submitRound(memberId, ['Spacing'], { status: 'errored' });
    await submitRound(memberId, ['Colour'], { status: 'rejected' });

    const { body } = await inbox(memberId);

    expect(body.items.map((item: { phase: string }) => item.phase)).toEqual(['failed', 'failed']);
  });

  it("leaves out accepted and closed rounds, drafts and other people's rounds", async () => {
    await submitRound(memberId, ['done'], { status: 'accepted', verdicts: ['passed'] });
    await submitRound(memberId, ['closed'], { status: 'closed' });
    await model.createDraft({ projectId, siteId: site.id, userId: memberId, workspaceId });
    await submitRound(ownerId, ['owner round'], { status: 'delivered' });

    const { body } = await inbox(memberId);

    expect(body.items).toEqual([]);
  });

  it('numbers rounds per site in submit order and lists the newest first', async () => {
    const first = await submitRound(ownerId, ['first']);
    const second = await submitRound(memberId, ['second']);
    const third = await submitRound(memberId, ['third']);

    const { body } = await inbox(memberId);

    expect(first.reviewId).toBeTruthy();
    expect(
      body.items.map((item: { reviewId: string; round: number }) => [item.reviewId, item.round]),
    ).toEqual([
      [third.reviewId, 3],
      [second.reviewId, 2],
    ]);
  });

  it('drops rounds on a site the user can no longer review', async () => {
    await submitRound(memberId, ['Spacing']);
    await serverDB.delete(projectMembers).where(eq(projectMembers.userId, memberId));
    await serverDB.delete(workspaceMembers).where(eq(workspaceMembers.userId, memberId));

    const { body } = await inbox(memberId);

    expect(body.items).toEqual([]);
  });

  it('keeps an older open round listed behind many newer finished ones', async () => {
    const open = await submitRound(memberId, ['Still open']);
    await serverDB
      .update(acceptanceReviews)
      .set({ submittedAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(acceptanceReviews.id, open.reviewId));
    const ids = Array.from({ length: 201 }, () => randomUUID());
    await serverDB.insert(tasks).values(
      ids.map((id, index) => ({
        createdByUserId: memberId,
        id,
        identifier: `T-BULK-${index}`,
        instruction: 'done',
        seq: index + 2,
        status: 'completed' as const,
      })),
    );
    await serverDB.insert(acceptances).values(
      ids.map((id) => ({
        projectId,
        status: 'accepted' as const,
        subjectId: id,
        subjectType: 'task' as const,
        userId: memberId,
        visibility: 'private' as const,
        workspaceId,
      })),
    );
    await serverDB.insert(acceptanceReviews).values(
      ids.map((taskId) => ({
        projectId,
        siteId: site.id,
        status: 'submitted' as const,
        submittedAt: new Date(),
        taskId,
        userId: memberId,
        workspaceId,
      })),
    );

    const { body } = await inbox(memberId);

    expect(body.items.map((item: { reviewId: string }) => item.reviewId)).toEqual([open.reviewId]);
  });

  it('refuses a missing token', async () => {
    expect((await app.request(INBOX)).status).toBe(401);
  });
});
