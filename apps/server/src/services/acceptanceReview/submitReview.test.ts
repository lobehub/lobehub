// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  acceptanceReviews,
  acceptances,
  agentOperations,
  agents,
  projects,
  tasks,
  taskTopics,
  topics,
  verifyCheckResults,
  verifyRuns,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceReviewModel } from '@/database/models/acceptanceReview';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';
import { instantiateVerifyPlanOnStart } from '@/server/services/verify/planInstantiation';

import { sendReviewRoundBack, submitReviewRound } from './submitReview';

let serverDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => serverDB }));
const execAgent = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent };
  }),
}));

describe('submitReviewRound', () => {
  let userId: string;
  let agentId: string;
  let projectId: string;
  let siteId: string;
  let reviewId: string;

  const geometry = {
    kind: 'region' as const,
    pageUrl: 'https://website.example/notebook',
    rectDocument: { height: 160, width: 384, x: 448, y: 1294 },
    rectViewport: { height: 160, width: 384, x: 448, y: 494 },
    route: '/notebook',
    scroll: { x: 0, y: 800 },
    viewport: { dpr: 2, height: 800, width: 1280 },
  };

  beforeEach(async () => {
    serverDB = await getTestDB();
    userId = await createTestUser(serverDB);
    const [agent] = await serverDB
      .insert(agents)
      .values({ title: 'Project Agent', userId })
      .returning();
    agentId = agent.id;
    const [project] = await serverDB
      .insert(projects)
      .values({ coordinatorAgentId: agentId, name: 'Website', userId })
      .returning();
    projectId = project.id;
    const [site] = await serverDB
      .insert(acceptances)
      .values({ projectId, subjectId: randomUUID(), subjectType: 'site', userId })
      .returning();
    siteId = site.id;
    const model = new AcceptanceReviewModel(serverDB);
    const review = await model.createDraft({
      acceptanceId: siteId,
      authorUserId: userId,
      pageTitle: 'Fieldnotes',
      pageUrl: 'https://website.example/notebook',
      projectId,
      route: '/notebook',
    });
    reviewId = review.id;
    await model.addMark(reviewId, { ...geometry, clientId: 'a', content: 'Cards are too tight' });
    await model.addMark(reviewId, { ...geometry, clientId: 'b', content: 'Button looks disabled' });

    execAgent.mockImplementation(async (params) => {
      const [topic] = await serverDB
        .insert(topics)
        .values({ agentId, projectId, userId })
        .returning();
      const operationId = randomUUID();
      await serverDB
        .insert(agentOperations)
        .values({ agentId, id: operationId, status: 'running', topicId: topic.id, userId });
      await params.onOperationCreated?.(operationId);
      return { operationId, success: true, topicId: topic.id };
    });
  });

  afterEach(async () => {
    execAgent.mockReset();
    await cleanupTestUser(serverDB, userId);
  });

  const submit = () =>
    submitReviewRound(serverDB, { userId, workspaceId: null }, reviewId, {
      summary: 'Spacing feels tight overall',
      title: 'Fieldnotes · 2 marks',
    });

  it('turns the round into one running project Task with a private delivery', async () => {
    const result = await submit();

    const [task] = await serverDB.select().from(tasks).where(eq(tasks.projectId, projectId));
    expect(result).toMatchObject({ taskId: task.id });
    expect(task).toMatchObject({
      assigneeAgentId: agentId,
      name: 'Fieldnotes · 2 marks',
      status: 'running',
      visibility: 'private',
    });
    expect(task.config).toMatchObject({ acceptanceReview: { reviewId } });
    expect(task.instruction).toContain('Cards are too tight');
    expect(task.instruction).toContain('Button looks disabled');
    expect(task.instruction).toContain('Spacing feels tight overall');

    const delivery = await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.subjectId, task.id),
    });
    expect(delivery).toMatchObject({ subjectType: 'task', visibility: 'private' });
    expect(delivery?.metadata?.reviewSource).toEqual({ reviewId });

    const stored = await serverDB.query.acceptanceReviews.findFirst({
      where: eq(acceptanceReviews.id, reviewId),
    });
    expect(stored).toMatchObject({
      deliveryAcceptanceId: delivery!.id,
      status: 'submitted',
      summary: 'Spacing feels tight overall',
      taskId: task.id,
      title: 'Fieldnotes · 2 marks',
    });
    expect(execAgent).toHaveBeenCalledTimes(1);
  });

  it('creates a single Task when the same round is submitted twice at once', async () => {
    const outcomes = await Promise.allSettled([submit(), submit()]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(await serverDB.select().from(tasks).where(eq(tasks.projectId, projectId))).toHaveLength(
      1,
    );
    expect(execAgent).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty round', async () => {
    const model = new AcceptanceReviewModel(serverDB);
    for (const mark of await model.listMarks(reviewId)) await model.deleteMark(reviewId, mark.id);

    await expect(submit()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await model.findById(reviewId))?.status).toBe('draft');
  });

  it('returns the round to draft when the Task cannot start, so a retry works', async () => {
    execAgent.mockRejectedValueOnce(new Error('runtime down'));

    await expect(submit()).rejects.toThrow();
    const model = new AcceptanceReviewModel(serverDB);
    expect((await model.findById(reviewId))?.status).toBe('draft');

    await submit();
    expect(await serverDB.select().from(tasks).where(eq(tasks.projectId, projectId))).toHaveLength(
      1,
    );
  });

  it('plans the delivery from the marks, with the mark ids as check ids', async () => {
    const { operationId, taskId } = await submit();
    await instantiateVerifyPlanOnStart(serverDB, userId, { operationId, taskId });

    const [run] = await serverDB
      .select()
      .from(verifyRuns)
      .where(eq(verifyRuns.operationId, operationId));
    const marks = await new AcceptanceReviewModel(serverDB).listMarks(reviewId);
    expect(run.plan?.map((item) => item.id)).toEqual(marks.map((mark) => mark.id));
    expect(run.planConfirmedAt).not.toBeNull();
    const delivery = await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.subjectId, taskId),
    });
    expect(run.acceptanceId).toBe(delivery!.id);
  });

  it('re-plans only the marks that still need work', async () => {
    const { deliveryAcceptanceId, operationId, taskId } = await submit();
    await instantiateVerifyPlanOnStart(serverDB, userId, { operationId, taskId });
    const [first] = await serverDB
      .select()
      .from(verifyRuns)
      .where(eq(verifyRuns.operationId, operationId));
    const [accepted, rejected] = await new AcceptanceReviewModel(serverDB).listMarks(reviewId);
    await serverDB.insert(verifyCheckResults).values([
      {
        checkItemId: accepted.id,
        status: 'passed' as const,
        userDecision: 'accepted' as const,
        userId,
        verdict: 'passed' as const,
        verifierType: 'agent' as const,
        verifyRunId: first.id,
      },
      {
        checkItemId: rejected.id,
        status: 'passed' as const,
        userDecision: 'rejected' as const,
        userId,
        verdict: 'passed' as const,
        verifierType: 'agent' as const,
        verifyRunId: first.id,
      },
    ]);

    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, projectId, userId })
      .returning();
    const retryOperationId = randomUUID();
    await serverDB
      .insert(agentOperations)
      .values({ agentId, id: retryOperationId, status: 'running', topicId: topic.id, userId });
    await instantiateVerifyPlanOnStart(serverDB, userId, { operationId: retryOperationId, taskId });

    const [retry] = await serverDB
      .select()
      .from(verifyRuns)
      .where(eq(verifyRuns.operationId, retryOperationId));
    expect(retry.plan?.map((item) => item.id)).toEqual([rejected.id]);
    expect(retry.acceptanceId).toBe(deliveryAcceptanceId);
  });

  it('sends a delivered round back by re-running the same Task on the marks still not fixed', async () => {
    const { deliveryAcceptanceId, operationId, taskId } = await submit();
    await instantiateVerifyPlanOnStart(serverDB, userId, { operationId, taskId });
    const [first] = await serverDB
      .select()
      .from(verifyRuns)
      .where(eq(verifyRuns.operationId, operationId));
    const [accepted, rejected] = await new AcceptanceReviewModel(serverDB).listMarks(reviewId);
    await serverDB.insert(verifyCheckResults).values([
      {
        checkItemId: accepted.id,
        status: 'passed' as const,
        userDecision: 'accepted' as const,
        userId,
        verdict: 'passed' as const,
        verifierType: 'agent' as const,
        verifyRunId: first.id,
      },
      {
        checkItemId: rejected.id,
        status: 'failed' as const,
        userDecision: 'rejected' as const,
        userId,
        verdict: 'failed' as const,
        verifierType: 'agent' as const,
        verifyRunId: first.id,
      },
    ]);
    await serverDB.update(verifyRuns).set({ status: 'failed' }).where(eq(verifyRuns.id, first.id));
    await serverDB
      .update(acceptances)
      .set({ status: 'delivered' })
      .where(eq(acceptances.id, deliveryAcceptanceId));
    await serverDB.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, taskId));
    await serverDB
      .update(taskTopics)
      .set({ status: 'completed' })
      .where(eq(taskTopics.taskId, taskId));

    const result = await sendReviewRoundBack(serverDB, { userId, workspaceId: null }, reviewId, {
      note: 'Still looks disabled on hover',
    });

    expect(result.taskId).toBe(taskId);
    expect(await serverDB.select().from(tasks).where(eq(tasks.projectId, projectId))).toHaveLength(
      1,
    );
    const handoff = JSON.stringify(execAgent.mock.calls.at(-1)?.[0]);
    expect(handoff).toContain('Still looks disabled on hover');
    const rework = handoff.slice(handoff.indexOf('Marks to rework'));
    const reworkList = rework.slice(0, rework.indexOf(']'));
    expect(reworkList).toContain(rejected.id);
    expect(reworkList).not.toContain(accepted.id);

    await instantiateVerifyPlanOnStart(serverDB, userId, {
      operationId: result.operationId,
      taskId,
    });
    const [retry] = await serverDB
      .select()
      .from(verifyRuns)
      .where(eq(verifyRuns.operationId, result.operationId));
    expect(retry.plan?.map((item) => item.id)).toEqual([rejected.id]);
    expect(retry.acceptanceId).toBe(deliveryAcceptanceId);
  });

  it('refuses to send back a round the Agent has not delivered yet', async () => {
    await submit();

    await expect(
      sendReviewRoundBack(serverDB, { userId, workspaceId: null }, reviewId, {}),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
