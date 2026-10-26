// @vitest-environment node
import type { GoalReportMetadata } from '@lobechat/types';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { works, workVersions } from '../../../schemas';
import { workspaces } from '../../../schemas/workspace';
import { WorkModel } from '..';
import type { WorkContext } from '../context';
import type { RegisterGoalReportWorkParams } from '../goalReport';
import { goalReportWorkAdapter } from '../goalReport';
import type { WorkspaceSummaryQueryRow } from '../internal';
import {
  cleanupWorkTestData,
  seedWorkTestData,
  serverDB,
  threadId,
  topicId,
  userId,
} from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

const goalId = 'goal-report-goal';
const workspaceId = 'goal-report-workspace';

const metadata: GoalReportMetadata = {
  chapters: [
    {
      detours: [],
      findingIds: [],
      narrative: 'Wrapped up the goal',
      nodeIds: [],
      title: 'Kickoff',
      workVersionIds: [],
    },
  ],
  graphCursor: 'goal-event-1',
  headline: 'Shipped the wrap-up report',
  nextSteps: [],
};

const reportParams = (
  overrides: Partial<RegisterGoalReportWorkParams> = {},
): RegisterGoalReportWorkParams => ({
  content: '# Wrap-up\n\nAll done.',
  goalId,
  metadata,
  threadId,
  title: 'Wrap-up report',
  toolCallId: 'op:goal-report',
  toolIdentifier: 'lobe-goal',
  toolName: 'submitGoalReport',
  topicId,
  ...overrides,
});

describe('WorkModel · goal report', () => {
  it('writes one personal goal_report Work and hides the page id when there is none', async () => {
    const model = new WorkModel(serverDB, userId);
    const work = await model.registerGoalReport(reportParams());

    const [row] = await serverDB.select().from(works).where(eq(works.id, work.id));
    expect(row).toMatchObject({
      description: 'Shipped the wrap-up report',
      resourceId: goalId,
      resourceType: 'goal_report',
      title: 'Wrap-up report',
      visibility: 'private',
    });
    const [version] = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.workId, work.id));
    expect(version.content).toBe('# Wrap-up\n\nAll done.');
    expect(version.metadata).toEqual({ goalReport: metadata });
  });

  it('appends a new version per submission and keeps the page document id', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerGoalReport(reportParams());
    await model.registerGoalReport(
      reportParams({
        content: '# Wrap-up v2',
        metadata: { ...metadata, headline: 'Second pass' },
        pageDocumentId: 'doc-goal-report',
        title: 'Wrap-up report v2',
        toolCallId: 'op:goal-report-2',
      }),
    );

    const latest = await model.findLatestGoalReport(goalId);
    expect(latest).toBeDefined();
    expect(latest!.content).toBe('# Wrap-up v2');
    expect(latest!.version).toBe(2);
    expect(latest!.metadata).toEqual({
      goalReport: { ...metadata, headline: 'Second pass' },
      goalReportPageId: 'doc-goal-report',
    });

    const [row] = await serverDB.select().from(works).where(eq(works.id, latest!.workId));
    expect(row).toMatchObject({ description: 'Second pass', title: 'Wrap-up report v2' });
  });

  it('publishes a workspace goal report to the whole workspace', async () => {
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Report workspace',
      primaryOwnerId: userId,
      slug: 'report-ws',
    });

    const model = new WorkModel(serverDB, userId, workspaceId);
    const work = await model.registerGoalReport(reportParams());

    const [row] = await serverDB.select().from(works).where(eq(works.id, work.id));
    expect(row.visibility).toBe('public');
    expect(row.workspaceId).toBe(workspaceId);
  });

  it('returns undefined when the goal has no report version', async () => {
    const model = new WorkModel(serverDB, userId);
    expect(await model.findLatestGoalReport('goal-without-report')).toBeUndefined();
  });

  it('keeps the goal report out of the generic Work listings', async () => {
    const ctx: WorkContext = { db: serverDB, userId };

    expect(
      await goalReportWorkAdapter.listConversationRows(ctx, {
        rowLimit: 5,
        threadFilter: sql`true`,
        topicId,
      }),
    ).toEqual([]);
    expect(await goalReportWorkAdapter.listVersionEvents(ctx, [], 5)).toEqual([]);
    expect(() => goalReportWorkAdapter.mapCurrentRow({} as WorkspaceSummaryQueryRow, null)).toThrow(
      'goal_report Works are not listed',
    );
  });
});
