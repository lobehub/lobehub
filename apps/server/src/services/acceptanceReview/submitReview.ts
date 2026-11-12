import type { SubmitAcceptanceReviewInput } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { AcceptanceReviewModel } from '@/database/models/acceptanceReview';
import { ProjectModel } from '@/database/models/project';
import { TaskModel } from '@/database/models/task';
import type { AcceptanceReviewMarkRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';
import { taskRouter } from '@/server/routers/lambda/task';
import { createTaskExecutionRouter } from '@/server/routers/lambda/task/execution';

import { projectReview } from './projection';
import {
  buildRoundInstruction,
  buildRoundName,
  countRound,
  loadReviewerName,
} from './roundContext';

export interface ReviewActor {
  userId: string;
  workspaceId: string | null;
}

const REVIEW_REQUIREMENT =
  'Fix every review mark and provide a verifiable preview with evidence for each mark.';

export const submitReviewRound = async (
  db: LobeChatDatabase,
  actor: ReviewActor,
  reviewId: string,
  input: SubmitAcceptanceReviewInput,
) => {
  const model = new AcceptanceReviewModel(db);
  const draft = await model.findById(reviewId);
  if (!draft || draft.status !== 'draft' || draft.userId !== actor.userId)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Review draft not found' });
  const marks = await model.listMarks(reviewId);
  if (!marks.length)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'A review needs at least one mark' });
  if (!draft.projectId)
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'The site has no project' });

  const claimed = await model.markSubmitted(reviewId);
  if (!claimed)
    throw new TRPCError({ code: 'CONFLICT', message: 'The review is already submitted' });

  try {
    const workspaceId = draft.workspaceId ?? undefined;
    const projectModel = new ProjectModel(db, actor.userId, workspaceId);
    const project = await projectModel.findById(draft.projectId);
    if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project is unavailable' });
    const agentId =
      input.agentId ??
      (await projectModel.resolveCoordinatorAgents([project]))[0].coordinatorAgentId;
    await assertCanUseWorkspaceAgent({
      agentId,
      db,
      userId: actor.userId,
      workspaceId: draft.workspaceId,
    });

    const ctx = { userId: actor.userId, workspaceId: draft.workspaceId } as never;
    const earlier = draft.taskId
      ? await new TaskModel(db, actor.userId, workspaceId).findById(draft.taskId)
      : null;
    let task = earlier;
    if (!task) {
      const [reviewer, round] = await Promise.all([
        loadReviewerName(db, claimed.userId),
        countRound(db, claimed),
      ]);
      task = (
        await taskRouter.createCaller(ctx).create({
          assigneeAgentId: agentId,
          config: {
            acceptanceReview: { reviewId },
            verify: { enabled: true, requirement: REVIEW_REQUIREMENT },
          },
          instruction: buildRoundInstruction(reviewer, round, marks, input.feedback),
          name: buildRoundName(reviewer, round, marks),
          projectId: project.id,
          visibility: 'private',
        })
      ).data;
      await model.linkTask(reviewId, task.id);
    }

    const result = await createTaskExecutionRouter(() => Promise.resolve())
      .createCaller(ctx)
      .run({ id: task.id });
    if (!result.operationId) throw new Error('The task run did not start');
    return { operationId: result.operationId, taskId: task.id };
  } catch (error) {
    await model
      .revertToDraft(reviewId)
      .catch((revertError) => console.error('[acceptance-review] revert failed', revertError));
    throw error;
  }
};

const runTask = async (actor: ReviewActor, taskId: string, prompt?: string) => {
  const ctx = { userId: actor.userId, workspaceId: actor.workspaceId } as never;
  const result = await createTaskExecutionRouter(() => Promise.resolve())
    .createCaller(ctx)
    .run({ id: taskId, prompt });
  if (!result.operationId) throw new Error('The task run did not start');
  return { operationId: result.operationId, taskId };
};

export const buildSendBackPrompt = (
  marks: Pick<AcceptanceReviewMarkRow, 'content' | 'id' | 'seq'>[],
  note?: string,
) =>
  [
    `The reviewer sent this review round back. Rework only these ${marks.length} marks; the other marks are accepted and must stay as they are.`,
    note ? `Reviewer's note:\n${note}` : '',
    `Marks to rework (JSON):\n${JSON.stringify(
      marks.map((mark) => ({ checkItemId: mark.id, comment: mark.content, seq: mark.seq })),
      null,
      2,
    )}`,
  ]
    .filter(Boolean)
    .join('\n\n');

export const sendReviewRoundBack = async (
  db: LobeChatDatabase,
  actor: ReviewActor,
  reviewId: string,
  input: { note?: string },
) => {
  const model = new AcceptanceReviewModel(db);
  const review = await model.findById(reviewId);
  if (!review || review.status !== 'submitted' || !review.taskId)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Review round not found' });
  const marks = await model.listMarks(reviewId);
  const projection = await projectReview(db, review, marks);
  if (projection.phase !== 'delivered')
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'The Agent has not delivered this round yet',
    });

  const open = marks.filter((mark) => projection.results.get(mark.id)?.human !== 'pass');
  const flagged = open.filter((mark) => {
    const result = projection.results.get(mark.id);
    return result?.human === 'not_fixed' || result?.agent?.verdict !== 'pass';
  });
  const rework = flagged.length ? flagged : open;
  if (!rework.length)
    throw new TRPCError({ code: 'CONFLICT', message: 'Every mark in this round has passed' });

  return runTask(
    { userId: actor.userId, workspaceId: review.workspaceId },
    review.taskId,
    buildSendBackPrompt(rework, input.note),
  );
};
