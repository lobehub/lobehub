import {
  acceptanceReviewDecisionSchema,
  createAcceptanceReviewCommentSchema,
} from '@lobechat/types';
import type { Context } from 'hono';
import { z } from 'zod';

import { AcceptanceReviewModel } from '@/database/models/acceptanceReview';
import { appEnv } from '@/envs/app';
import { acceptanceRouter } from '@/server/routers/lambda/acceptance';
import { acceptanceCommentRouter } from '@/server/routers/lambda/acceptanceComment';

import type { ReviewEnv } from './auth';
import { commentBelongsTo, findProfile, latestRound, uploadScreenshot } from './data';
import { reviewError } from './errors';
import { toReviewComment, toReviewThreads } from './mapping';
import { parseBody } from './parseBody';

type ReviewContext = Context<ReviewEnv>;

const callerContext = (c: ReviewContext) => ({ userId: c.get('userId') }) as never;
const commentCaller = (c: ReviewContext) => acceptanceCommentRouter.createCaller(callerContext(c));
const acceptanceCaller = (c: ReviewContext) => acceptanceRouter.createCaller(callerContext(c));

const viewer = (c: ReviewContext) => ({ userId: c.get('userId') });

export const getSession = async (c: ReviewContext) => {
  const { acceptance, can } = c.get('access');
  const db = c.get('db');
  const userId = c.get('userId');
  const [round, profile, linkedReview] = await Promise.all([
    latestRound(db, acceptance.id),
    findProfile(db, userId),
    acceptance.subjectType === 'task'
      ? new AcceptanceReviewModel(db).findByTask(acceptance.subjectId)
      : undefined,
  ]);
  return c.json({
    acceptance: {
      id: acceptance.id,
      previewUrl: round.previewUrl,
      requirement: acceptance.requirement ?? undefined,
      round: round.round,
      status: acceptance.status,
      title: acceptance.metadata?.title || acceptance.requirement || '',
      url: `${(appEnv.APP_URL ?? '').replace(/\/$/, '')}/acceptance/${acceptance.id}`,
    },
    can,
    expiresAt: new Date(c.get('expiresAt') * 1000).toISOString(),
    features: acceptance.subjectType === 'site' || linkedReview ? ['review-rounds'] : [],
    review: linkedReview ? { id: linkedReview.id } : undefined,
    project: c.get('project'),
    role: c.get('role') ?? undefined,
    site: c.get('site'),
    user: {
      avatar: profile?.avatar ?? undefined,
      id: userId,
      name: profile?.fullName || profile?.username || '',
    },
  });
};

export const listComments = async (c: ReviewContext) => {
  const acceptanceId = c.get('access').acceptance.id;
  const [{ items }, markReplies] = await Promise.all([
    commentCaller(c).list({ acceptanceId }),
    new AcceptanceReviewModel(c.get('db')).listReplyIds(acceptanceId),
  ]);
  const visible = items.filter((item) => !markReplies.has(item.id));
  return c.json({ items: toReviewThreads(visible, viewer(c)) });
};

export const createComment = async (c: ReviewContext) => {
  const body = await parseBody(c, createAcceptanceReviewCommentSchema);
  if (body.error) return body.error;
  const input = body.data;
  const { acceptance, can } = c.get('access');
  if (!can.comment) return reviewError(c, 403, 'FORBIDDEN', 'Read-only access');

  const db = c.get('db');
  const { runId } = await latestRound(db, acceptance.id);
  // The remark is what the reviewer came to say; a storage outage or a full
  // quota drops only the picture, and the toolbar tells them so.
  const fileId = input.screenshot
    ? await uploadScreenshot(
        db,
        c.get('userId'),
        acceptance.workspaceId,
        input.screenshot.dataUrl,
      ).catch((error) => {
        console.error('[acceptance-review] screenshot upload failed', error);
        return undefined;
      })
    : undefined;
  const { data } = await commentCaller(c).create({
    acceptanceId: acceptance.id,
    attachments: fileId ? [{ fileId }] : undefined,
    clientId: input.clientId,
    content: input.content,
    contextRunId: runId,
    parentCommentId: input.parentId,
    source: input.anchor,
  });
  return c.json(toReviewComment(data, viewer(c)), 201);
};

const ownComment = async (c: ReviewContext) => {
  const id = c.req.param('id') ?? '';
  const found = await commentBelongsTo(c.get('db'), id, c.get('access').acceptance.id);
  return found ? id : undefined;
};

export const setResolved = async (c: ReviewContext) => {
  const body = await parseBody(c, z.object({ resolved: z.boolean() }));
  if (body.error) return body.error;
  const id = await ownComment(c);
  if (!id) return reviewError(c, 404, 'NOT_FOUND', 'Comment not found');
  const { data } = await commentCaller(c).setResolved({ id, resolved: body.data.resolved });
  return c.json({
    id,
    resolvedAt: data.resolvedAt ? new Date(data.resolvedAt).toISOString() : null,
  });
};

export const deleteComment = async (c: ReviewContext) => {
  const id = await ownComment(c);
  if (!id) return reviewError(c, 404, 'NOT_FOUND', 'Comment not found');
  await commentCaller(c).delete({ id });
  return c.body(null, 204);
};

export const decide = async (c: ReviewContext) => {
  const body = await parseBody(c, acceptanceReviewDecisionSchema);
  if (body.error) return body.error;
  const { note, verdict } = body.data;
  const { acceptance, can } = c.get('access');
  if (!(verdict === 'accept' ? can.decide : can.reject))
    return reviewError(c, 403, 'FORBIDDEN', 'Not allowed to decide this acceptance');

  const open = verdict === 'accept' ? ['delivered'] : ['delivered', 'errored'];
  if (!open.includes(acceptance.status))
    return reviewError(c, 409, 'INVALID_STATE', `The acceptance is ${acceptance.status}`);

  if (verdict === 'accept') {
    const accepted = await acceptanceCaller(c).accept({ comment: note, id: acceptance.id });
    return c.json({ status: accepted.status });
  }
  const rejected = await acceptanceCaller(c).reject({ comment: note, id: acceptance.id });
  return c.json({ dispatched: rejected.repairDispatch.dispatched, status: rejected.status });
};
