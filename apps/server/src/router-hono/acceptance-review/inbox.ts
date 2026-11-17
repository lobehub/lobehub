import type { AcceptanceReview } from '@lobechat/types';
import { and, countDistinct, desc, eq, isNull, notInArray, or } from 'drizzle-orm';
import type { Context } from 'hono';
import pMap from 'p-map';

import { AcceptanceReviewModel } from '@/database/models/acceptanceReview';
import {
  acceptanceReviews,
  acceptances,
  projectSites,
  tasks,
  verifyCheckResults,
  verifyRuns,
  workspaces,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { resolveReviewAccess } from '@/server/services/acceptanceReview/access';
import { projectReview } from '@/server/services/acceptanceReview/projection';

import type { ReviewEnv } from './auth';

const INBOX_LIMIT = 50;
const CANDIDATE_LIMIT = 200;
const IO_CONCURRENCY = 5;
const NEVER_DELIVERS = new Set(['errored']);
const FINISHED = new Set(['accepted', 'closed']);

type InboxPhase = 'delivered' | 'failed' | 'running';

const latestRunTime = async (db: LobeChatDatabase, acceptanceId: string) => {
  const [run] = await db
    .select({ updatedAt: verifyRuns.updatedAt })
    .from(verifyRuns)
    .where(eq(verifyRuns.acceptanceId, acceptanceId))
    .orderBy(desc(verifyRuns.roundIndex))
    .limit(1);
  return run?.updatedAt.toISOString();
};

// A send-back reruns the Task without recording a reject decision, so deliveries are counted from
// the verify rounds that produced a result: every run of the Task opens one.
const deliveryNumber = async (db: LobeChatDatabase, acceptanceId: string) => {
  const [row] = await db
    .select({ n: countDistinct(verifyRuns.id) })
    .from(verifyRuns)
    .innerJoin(verifyCheckResults, eq(verifyCheckResults.verifyRunId, verifyRuns.id))
    .where(eq(verifyRuns.acceptanceId, acceptanceId));
  return Math.max(Number(row?.n ?? 0), 1);
};

const taskLink = async (db: LobeChatDatabase, taskId: string) => {
  const [row] = await db
    .select({ identifier: tasks.identifier, slug: workspaces.slug })
    .from(tasks)
    .leftJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!row?.identifier) return undefined;
  const path = `/task/${row.identifier}`;
  return { identifier: row.identifier, path: row.slug ? `/${row.slug}${path}` : path };
};

const createSiteLookup = (db: LobeChatDatabase, userId: string) => {
  const model = new AcceptanceReviewModel(db);
  const sites = new Map<string, Promise<{ name: string; order: string[] } | undefined>>();
  const load = async (siteId: string) => {
    const [site] = await db
      .select({ acceptanceId: projectSites.acceptanceId, name: projectSites.name })
      .from(projectSites)
      .where(eq(projectSites.id, siteId))
      .limit(1);
    if (!site?.acceptanceId) return undefined;
    const access = await resolveReviewAccess(db, userId, site.acceptanceId);
    if (!access?.can.comment) return undefined;
    const submitted = await model.listSubmitted(siteId);
    return { name: site.name, order: submitted.map((row) => row.id) };
  };
  return (siteId: string) => {
    let found = sites.get(siteId);
    if (!found) {
      found = load(siteId);
      sites.set(siteId, found);
    }
    return found;
  };
};

const describeRound = async (
  db: LobeChatDatabase,
  row: AcceptanceReview,
  site: { name: string; order: string[] },
) => {
  const marks = await new AcceptanceReviewModel(db).listMarks(row.id);
  const projection = await projectReview(db, row, marks, { evidence: false });
  if (FINISHED.has(projection.phase)) return undefined;
  const phase: InboxPhase =
    projection.deliveryStatus && NEVER_DELIVERS.has(projection.deliveryStatus)
      ? 'failed'
      : projection.phase === 'delivered'
        ? 'delivered'
        : 'running';
  const delivered = phase === 'delivered' && projection.deliveryId;
  const [deliveredAt, delivery, task] = await Promise.all([
    delivered ? latestRunTime(db, projection.deliveryId!) : undefined,
    delivered ? deliveryNumber(db, projection.deliveryId!) : undefined,
    projection.task ? taskLink(db, projection.task.id) : undefined,
  ]);
  const first = marks[0];
  const index = site.order.indexOf(row.id);
  const passed = projection.counts.agentPassed;
  return {
    deliveredAt,
    delivery,
    marks: marks.length,
    name: first?.content ?? '',
    notPassed: marks.length - passed,
    passed,
    phase,
    reviewId: row.id,
    round: index < 0 ? 0 : site.order.length - index,
    site: { id: row.siteId, name: site.name },
    submittedAt: (row.submittedAt ?? row.createdAt).toISOString(),
    task,
    url: first?.url ?? '',
  };
};

export const getExtensionInbox = async (c: Context<ReviewEnv>) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const joined = await db
    .select({ review: acceptanceReviews })
    .from(acceptanceReviews)
    .leftJoin(
      acceptances,
      and(eq(acceptances.subjectType, 'task'), eq(acceptances.subjectId, acceptanceReviews.taskId)),
    )
    .where(
      and(
        eq(acceptanceReviews.userId, userId),
        eq(acceptanceReviews.status, 'submitted'),
        or(isNull(acceptances.status), notInArray(acceptances.status, ['accepted', 'closed'])),
      ),
    )
    .orderBy(desc(acceptanceReviews.submittedAt), desc(acceptanceReviews.createdAt))
    .limit(CANDIDATE_LIMIT);
  const rows = [...new Map(joined.map(({ review }) => [review.id, review])).values()];
  const siteFor = createSiteLookup(db, userId);
  const described = await pMap(
    rows,
    async (row) => {
      const site = await siteFor(row.siteId);
      return site ? describeRound(db, row, site) : undefined;
    },
    { concurrency: IO_CONCURRENCY },
  );
  const items = described.filter((item) => item !== undefined).slice(0, INBOX_LIMIT);
  return c.json({ items });
};
