import type { GoalReportMetadata, WorkItem } from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

import { works, workVersions } from '../../schemas/work';
import { type WorkContext, workOwnership } from './context';
import { truncateSummaryText, type WorkTypeAdapter, type WorkVersionEventParams } from './internal';
import { registerWorkVersion } from './writes';

export interface RegisterGoalReportWorkParams extends Omit<WorkVersionEventParams, 'changeType'> {
  /** The full written report, as markdown. */
  content: string;
  goalId: string;
  metadata: GoalReportMetadata;
  title: string;
}

/**
 * One `goal_report` Work per Goal (keyed by the goal id); every submission
 * appends a version. The structured storyline goes to the version's metadata,
 * the full report to its content.
 */
export const registerGoalReportWork = (
  ctx: WorkContext,
  params: RegisterGoalReportWorkParams,
): Promise<WorkItem> => {
  const { content, goalId, metadata, title, ...event } = params;
  return registerWorkVersion(
    ctx,
    {
      resourceId: goalId,
      resourceType: 'goal_report',
      type: 'goal_report',
      userId: ctx.userId,
      // Goals carry no visibility of their own: every member of the workspace
      // reads the goal, so its report follows the goal rather than the author.
      visibility: ctx.workspaceId ? 'public' : 'private',
    },
    { ...event, changeType: 'updated' },
    () => ({
      display: {
        content,
        description: truncateSummaryText(metadata.headline),
        identifier: null,
        status: null,
        title,
        url: null,
      },
      metadata: { goalReport: metadata },
    }),
  );
};

/** Newest report version of a Goal, or undefined when none was submitted. */
export const findLatestGoalReportVersion = async (ctx: WorkContext, goalId: string) => {
  const [row] = await ctx.db
    .select({
      content: workVersions.content,
      createdAt: workVersions.createdAt,
      metadata: workVersions.metadata,
      version: workVersions.version,
      workId: works.id,
      workVersionId: workVersions.id,
    })
    .from(workVersions)
    .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
    .where(and(eq(works.resourceType, 'goal_report'), eq(works.resourceId, goalId)))
    .orderBy(desc(workVersions.version))
    .limit(1);
  return row;
};

/**
 * Goal reports are read through the goal graph, never the generic Work lists:
 * shipped clients have no descriptor for the type, and a report without its
 * goal has nothing to open. The adapter exists so the registry stays total.
 */
export const goalReportWorkAdapter: WorkTypeAdapter = {
  listConversationRows: async () => [],
  listVersionEvents: async () => [],
  mapCurrentRow: () => {
    throw new Error('goal_report Works are not listed');
  },
};
