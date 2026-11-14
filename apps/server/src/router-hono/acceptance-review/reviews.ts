import type { AcceptanceReview } from '@lobechat/types';
import {
  acceptanceReviewDecisionSchema,
  acceptanceReviewMarkVerdictSchema,
  createAcceptanceReviewMarkSchema,
  createAcceptanceReviewReplySchema,
  FileSource,
  submitAcceptanceReviewSchema,
  updateAcceptanceReviewMarkSchema,
} from '@lobechat/types';
import type { Context } from 'hono';
import pMap from 'p-map';

import { AcceptanceReviewModel } from '@/database/models/acceptanceReview';
import { ProjectModel } from '@/database/models/project';
import { ProjectSiteModel } from '@/database/models/projectReview';
import { acceptanceRouter } from '@/server/routers/lambda/acceptance';
import { projectReview } from '@/server/services/acceptanceReview/projection';
import {
  sendReviewRoundBack,
  submitReviewRound,
} from '@/server/services/acceptanceReview/submitReview';
import { FileService } from '@/server/services/file';

import type { ReviewEnv } from './auth';
import { uploadScreenshot } from './data';
import { reviewError } from './errors';
import { parseBody } from './parseBody';
import { loadAuthors, screenshotResolver, toMarkDto, toReviewDto } from './reviewMapping';

type ReviewContext = Context<ReviewEnv>;

const IO_CONCURRENCY = 5;

const reviews = (c: ReviewContext) => new AcceptanceReviewModel(c.get('db'));

const siteAcceptance = (c: ReviewContext) => {
  const { acceptance } = c.get('access');
  return acceptance.subjectType === 'site' ? acceptance : undefined;
};

export interface ReviewScope {
  load: (reviewId: string) => Promise<AcceptanceReview | undefined>;
  ownerUserId: string;
  workspaceId: string | null;
}

export const reviewScope = (c: ReviewContext): ReviewScope | undefined => {
  const { acceptance } = c.get('access');
  const visible = (row: AcceptanceReview | undefined) => {
    if (!row || row.status === 'discarded') return undefined;
    if (row.status === 'draft' && row.userId !== c.get('userId')) return undefined;
    return row;
  };
  const siteId = c.get('site')?.id;
  if (acceptance.subjectType === 'site' && siteId)
    return {
      load: async (reviewId) => {
        const row = await reviews(c).findById(reviewId);
        return row?.siteId === siteId ? visible(row) : undefined;
      },
      ownerUserId: acceptance.userId,
      workspaceId: acceptance.workspaceId,
    };
  if (acceptance.subjectType !== 'task') return undefined;
  return {
    load: async (reviewId) => {
      const row = await reviews(c).findById(reviewId);
      return row?.taskId === acceptance.subjectId ? visible(row) : undefined;
    },
    ownerUserId: acceptance.userId,
    workspaceId: acceptance.workspaceId,
  };
};

const repliesAcceptanceId = async (c: ReviewContext, row: AcceptanceReview) => {
  const site = siteAcceptance(c);
  if (site) return site.id;
  return (await new ProjectSiteModel(c.get('db')).findById(row.siteId))?.acceptanceId ?? undefined;
};

export const describeReview = async (
  c: ReviewContext,
  scope: ReviewScope,
  row: AcceptanceReview,
  options: { withMarks?: boolean } = {},
) => {
  const db = c.get('db');
  const model = reviews(c);
  const [authors, marks] = await Promise.all([
    loadAuthors(db, [row.userId]),
    model.listMarks(row.id),
  ]);
  const projection = await projectReview(db, row, marks);
  const replies = options.withMarks
    ? await model.countReplies(marks.map((mark) => mark.id))
    : undefined;
  const screenshot = screenshotResolver(db, scope.ownerUserId, scope.workspaceId);
  return toReviewDto(row, {
    markCount: marks.length,
    marks: options.withMarks
      ? await pMap(
          marks,
          async (mark) =>
            toMarkDto(mark, {
              replyCount: replies?.get(mark.id),
              result: projection.results.get(mark.id),
              screenshot: await screenshot(mark.screenshotFileId),
            }),
          { concurrency: IO_CONCURRENCY },
        )
      : undefined,
    projection,
    user: row.userId ? authors.get(row.userId) : undefined,
    viewerId: c.get('userId'),
  });
};

const notFound = (c: ReviewContext) => reviewError(c, 404, 'NOT_FOUND', 'Review not found');

const ownDraft = async (c: ReviewContext) => {
  const scope = reviewScope(c);
  const row = scope ? await scope.load(c.req.param('id') ?? '') : undefined;
  if (!scope || !row || row.userId !== c.get('userId')) return { error: notFound(c) };
  if (row.status !== 'draft')
    return { error: reviewError(c, 409, 'INVALID_STATE', 'The review is already submitted') };
  return { row, scope };
};

const removeScreenshot = async (c: ReviewContext, fileId: string | null) => {
  if (!fileId) return;
  const site = siteAcceptance(c);
  await new FileService(c.get('db'), c.get('userId'), site?.workspaceId ?? undefined)
    .removeUnreferencedFile(fileId, FileSource.Acceptance)
    .catch((error) => console.error('[acceptance-review] screenshot cleanup failed', error));
};

export const listReviews = async (c: ReviewContext) => {
  const scope = reviewScope(c);
  if (!scope) return notFound(c);
  const siteId = c.get('site')?.id;
  if (!siteAcceptance(c) || !siteId) {
    const linked = await reviews(c).findByTask(c.get('access').acceptance.subjectId);
    const row = linked ? await scope.load(linked.id) : undefined;
    return c.json({ draft: null, items: row ? [await describeReview(c, scope, row)] : [] });
  }
  const route = c.req.query('route');
  const model = reviews(c);
  const [submitted, draft] = await Promise.all([
    model.listSubmitted(siteId, route || undefined),
    model.findDraft(siteId, c.get('userId')),
  ]);
  return c.json({
    draft: draft ? await describeReview(c, scope, draft) : null,
    items: await pMap(submitted, (row) => describeReview(c, scope, row), {
      concurrency: IO_CONCURRENCY,
    }),
  });
};

export const startReview = async (c: ReviewContext) => {
  const scope = reviewScope(c);
  const site = siteAcceptance(c);
  const siteId = c.get('site')?.id;
  if (!scope || !site || !siteId) return notFound(c);
  const model = reviews(c);
  const userId = c.get('userId');

  const conflict = async () => {
    const existing = await model.findDraft(siteId, userId);
    if (!existing) return undefined;
    return c.json(
      {
        error: { code: 'INVALID_STATE', message: 'A review is already in progress' },
        review: await describeReview(c, scope, existing),
      },
      409,
    );
  };

  const early = await conflict();
  if (early) return early;
  try {
    const row = await model.createDraft({
      projectId: site.projectId,
      siteId,
      userId,
      workspaceId: site.workspaceId,
    });
    return c.json(await describeReview(c, scope, row), 201);
  } catch (error) {
    const raced = await conflict();
    if (raced) return raced;
    throw error;
  }
};

const submittedReview = async (c: ReviewContext) => {
  const scope = reviewScope(c);
  const row = scope ? await scope.load(c.req.param('id') ?? '') : undefined;
  return scope && row ? { row, scope } : undefined;
};

export const getReview = async (c: ReviewContext) => {
  const found = await submittedReview(c);
  if (!found) return notFound(c);
  return c.json(await describeReview(c, found.scope, found.row, { withMarks: true }));
};

export const discardReview = async (c: ReviewContext) => {
  const draft = await ownDraft(c);
  if (draft.error) return draft.error;
  const marks = await reviews(c).listMarks(draft.row.id);
  await reviews(c).discard(draft.row.id);
  await pMap(marks, (mark) => removeScreenshot(c, mark.screenshotFileId), {
    concurrency: IO_CONCURRENCY,
  });
  return c.body(null, 204);
};

export const addMark = async (c: ReviewContext) => {
  const body = await parseBody(c, createAcceptanceReviewMarkSchema);
  if (body.error) return body.error;
  const draft = await ownDraft(c);
  if (draft.error) return draft.error;
  const { screenshot, ...input } = body.data;
  const db = c.get('db');
  const model = reviews(c);

  const existing = (await model.listMarks(draft.row.id)).find(
    (mark) => mark.clientId === input.clientId,
  );
  const screenshotFileId =
    existing || !screenshot
      ? undefined
      : await uploadScreenshot(
          db,
          c.get('userId'),
          draft.scope.workspaceId,
          screenshot.dataUrl,
        ).catch((error) => {
          console.error('[acceptance-review] screenshot upload failed', error);
          return undefined;
        });
  const row = await model.addMark(draft.row.id, { ...input, screenshotFileId });
  if (!row) return reviewError(c, 409, 'INVALID_STATE', 'The review is already submitted');
  const resolve = screenshotResolver(db, draft.scope.ownerUserId, draft.scope.workspaceId);
  return c.json(toMarkDto(row, { screenshot: await resolve(row.screenshotFileId) }), 201);
};

export const updateMark = async (c: ReviewContext) => {
  const body = await parseBody(c, updateAcceptanceReviewMarkSchema);
  if (body.error) return body.error;
  const draft = await ownDraft(c);
  if (draft.error) return draft.error;
  const row = await reviews(c).updateMark(draft.row.id, c.req.param('markId') ?? '', body.data);
  if (!row) return reviewError(c, 404, 'NOT_FOUND', 'Mark not found');
  const resolve = screenshotResolver(c.get('db'), draft.scope.ownerUserId, draft.scope.workspaceId);
  return c.json(toMarkDto(row, { screenshot: await resolve(row.screenshotFileId) }));
};

export const deleteMark = async (c: ReviewContext) => {
  const draft = await ownDraft(c);
  if (draft.error) return draft.error;
  const markId = c.req.param('markId') ?? '';
  const mark = await reviews(c).findMark(draft.row.id, markId);
  if (!mark || !(await reviews(c).deleteMark(draft.row.id, markId)))
    return reviewError(c, 404, 'NOT_FOUND', 'Mark not found');
  await removeScreenshot(c, mark.screenshotFileId);
  return c.body(null, 204);
};

export const submitReview = async (c: ReviewContext) => {
  const body = await parseBody(c, submitAcceptanceReviewSchema);
  if (body.error) return body.error;
  const draft = await ownDraft(c);
  if (draft.error) return draft.error;
  await submitReviewRound(
    c.get('db'),
    { userId: c.get('userId'), workspaceId: draft.row.workspaceId },
    draft.row.id,
    body.data,
  );
  const row = await reviews(c).findById(draft.row.id);
  return c.json(await describeReview(c, draft.scope, row ?? draft.row, { withMarks: true }));
};

export const listAgents = async (c: ReviewContext) => {
  const site = siteAcceptance(c);
  if (!site?.projectId) return c.json({ items: [] });
  const projectModel = new ProjectModel(
    c.get('db'),
    c.get('userId'),
    site.workspaceId ?? undefined,
  );
  const project = await projectModel.findById(site.projectId);
  if (!project) return c.json({ items: [] });
  const [{ coordinatorAgentId }] = await projectModel.resolveCoordinatorAgents([project]);
  const [agent] = await c
    .get('db')
    .query.agents.findMany({ where: (agents, { eq }) => eq(agents.id, coordinatorAgentId) });
  return c.json({
    items: agent
      ? [
          {
            avatar: agent.avatar ?? undefined,
            coordinator: true,
            id: agent.id,
            title: agent.title ?? '',
          },
        ]
      : [],
  });
};

const acceptanceCaller = (c: ReviewContext) =>
  acceptanceRouter.createCaller({ userId: c.get('userId') } as never);

export const setMarkVerdict = async (c: ReviewContext) => {
  const body = await parseBody(c, acceptanceReviewMarkVerdictSchema);
  if (body.error) return body.error;
  const found = await submittedReview(c);
  if (!found || found.row.status !== 'submitted' || !found.row.taskId) return notFound(c);
  const db = c.get('db');
  const marks = await reviews(c).listMarks(found.row.id);
  const markId = c.req.param('markId') ?? '';
  const projection = await projectReview(db, found.row, marks);
  const check = projection.checks.get(markId);
  if (!check) return reviewError(c, 409, 'INVALID_STATE', 'This mark has no result to judge yet');
  const deliveryId = projection.deliveryId;
  if (!deliveryId || projection.deliveryStatus !== 'delivered')
    return reviewError(c, 409, 'INVALID_STATE', 'The delivery is not waiting for review');

  await acceptanceCaller(c).reviewChecks({
    action: body.data.verdict === 'pass' ? 'accept' : 'reject',
    checkItemIds: [check.checkId],
    comment: body.data.verdict === 'pass' ? body.data.reason : body.data.reason || 'Not fixed',
    id: deliveryId,
  });

  if (body.data.verdict === 'pass') {
    const after = await projectReview(db, found.row, marks);
    const allPassed = marks.every((mark) => after.results.get(mark.id)?.human === 'pass');
    if (allPassed) await acceptanceCaller(c).accept({ id: deliveryId });
  }
  return c.json(await describeReview(c, found.scope, found.row, { withMarks: true }));
};

export const sendReviewBack = async (c: ReviewContext) => {
  const body = await parseBody(c, acceptanceReviewDecisionSchema.pick({ note: true }));
  if (body.error) return body.error;
  const found = await submittedReview(c);
  if (!found || found.row.status !== 'submitted') return notFound(c);
  await sendReviewRoundBack(
    c.get('db'),
    { userId: c.get('userId'), workspaceId: found.row.workspaceId },
    found.row.id,
    { note: body.data.note },
  );
  const row = await reviews(c).findById(found.row.id);
  return c.json(await describeReview(c, found.scope, row ?? found.row, { withMarks: true }));
};

const replyMark = async (c: ReviewContext) => {
  const found = await submittedReview(c);
  if (!found || found.row.status !== 'submitted') return undefined;
  const mark = await reviews(c).findMark(found.row.id, c.req.param('markId') ?? '');
  return mark ? { ...found, mark } : undefined;
};

export const listMarkReplies = async (c: ReviewContext) => {
  const found = await replyMark(c);
  if (!found) return notFound(c);
  const rows = await reviews(c).listReplies(found.mark.id);
  const authors = await loadAuthors(
    c.get('db'),
    rows.map((row) => row.authorUserId),
  );
  return c.json({
    items: rows.map((row) => ({
      author: (row.authorUserId && authors.get(row.authorUserId)) || {
        id: row.authorUserId ?? '',
        name: '',
      },
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      mine: row.authorUserId === c.get('userId'),
    })),
  });
};

export const addMarkReply = async (c: ReviewContext) => {
  const body = await parseBody(c, createAcceptanceReviewReplySchema);
  if (body.error) return body.error;
  const found = await replyMark(c);
  if (!found) return notFound(c);
  if (!c.get('access').can.comment) return reviewError(c, 403, 'FORBIDDEN', 'Read-only access');
  const acceptanceId = await repliesAcceptanceId(c, found.row);
  if (!acceptanceId) return notFound(c);
  const row = await reviews(c).addReply(acceptanceId, found.mark.id, {
    authorUserId: c.get('userId'),
    clientId: body.data.clientId,
    content: body.data.content,
    workspaceId: found.row.workspaceId,
  });
  return c.json(
    { content: row.content, createdAt: row.createdAt.toISOString(), id: row.id, mine: true },
    201,
  );
};
