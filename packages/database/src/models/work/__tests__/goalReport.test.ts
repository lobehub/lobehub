// @vitest-environment node
import type { GoalReportMetadata } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { works, workspaces } from '../../../schemas';
import { WorkModel } from '..';
import { goalReportWorkAdapter } from '../goalReport';
import {
  cleanupWorkTestData,
  seedWorkTestData,
  serverDB,
  topicId,
  userId,
  userId2,
} from './_fixtures';

const goalId = 'goal-report-test-goal';
const goalId2 = 'goal-report-test-goal-2';
const workspaceId = 'goal-report-test-workspace';

const buildMetadata = (headline: string): GoalReportMetadata => ({
  chapters: [
    {
      detours: [],
      findingIds: [],
      narrative: 'Shipped the goal.',
      nodeIds: [],
      title: 'Wrap-up',
      workVersionIds: [],
    },
  ],
  graphCursor: 'goal-event-1',
  headline,
  nextSteps: [],
});

const registerReport = (
  workModel: WorkModel,
  params: { content: string; goalId?: string; headline?: string; toolCallId: string },
) =>
  workModel.registerGoalReport({
    content: params.content,
    goalId: params.goalId ?? goalId,
    metadata: buildMetadata(params.headline ?? 'Goal wrapped up'),
    title: 'Goal report',
    toolCallId: params.toolCallId,
    toolIdentifier: 'lobe-agent-documents',
    toolName: 'writeGoalReport',
    topicId,
  });

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

describe('WorkModel · goal report', () => {
  it('registers one goal_report Work per goal and appends a version per submission', async () => {
    const workModel = new WorkModel(serverDB, userId);

    const first = await registerReport(workModel, { content: '# Report v1', toolCallId: 'call-1' });

    expect(first).toMatchObject({
      resourceId: goalId,
      resourceType: 'goal_report',
      // Goals carry no visibility of their own, so an owner-scoped report stays private.
      visibility: 'private',
    });

    const firstVersions = await workModel.listVersions(first.id);
    expect(firstVersions).toHaveLength(1);
    expect(firstVersions[0]).toMatchObject({
      changeType: 'updated',
      content: '# Report v1',
      title: 'Goal report',
      version: 1,
    });
    expect(firstVersions[0].metadata).toMatchObject({
      goalReport: { graphCursor: 'goal-event-1' },
    });

    const second = await registerReport(workModel, {
      content: '# Report v2',
      toolCallId: 'call-2',
    });

    // Same Work identity — the report is keyed by the goal, not by the run.
    expect(second.id).toBe(first.id);
    const versions = await workModel.listVersions(first.id);
    expect(versions).toHaveLength(2);
    expect(versions.map((version) => version.version).sort()).toEqual([1, 2]);

    const [row] = await serverDB.select().from(works);
    expect(row.currentVersionId).toBeDefined();
  });

  it('keeps goal reports private per user', async () => {
    const ownerModel = new WorkModel(serverDB, userId);
    const otherModel = new WorkModel(serverDB, userId2);

    await registerReport(ownerModel, { content: '# Mine', toolCallId: 'call-owner' });

    expect(await otherModel.findLatestGoalReport(goalId)).toBeUndefined();
    expect(await ownerModel.findLatestGoalReport(goalId)).toBeDefined();
  });

  it('marks the report public when the Work is registered inside a workspace', async () => {
    await serverDB
      .insert(workspaces)
      .values({
        id: workspaceId,
        name: 'goal report ws',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
    const workspaceModel = new WorkModel(serverDB, userId, workspaceId);

    const work = await registerReport(workspaceModel, {
      content: '# Shared',
      toolCallId: 'call-ws',
    });

    expect(work.visibility).toBe('public');
  });

  it('truncates an over-long headline into the Work description', async () => {
    const workModel = new WorkModel(serverDB, userId);
    const headline = 'A '.repeat(200).trim();

    const work = await registerReport(workModel, {
      content: '# Long',
      headline,
      toolCallId: 'call-long',
    });

    expect(work.description).toBe(`${headline.slice(0, 120)}...`);
  });

  it('finds the newest report version of a goal', async () => {
    const workModel = new WorkModel(serverDB, userId);

    await registerReport(workModel, { content: '# First', toolCallId: 'v1' });
    await registerReport(workModel, { content: '# Second', toolCallId: 'v2' });

    const latest = await workModel.findLatestGoalReport(goalId);
    expect(latest).toMatchObject({
      content: '# Second',
      version: 2,
      workVersionId: expect.any(String),
    });

    // A different goal has no report of its own.
    expect(await workModel.findLatestGoalReport(goalId2)).toBeUndefined();
  });

  it('exposes a registry adapter that never lists goal reports', async () => {
    await expect(goalReportWorkAdapter.listConversationRows({} as never)).resolves.toEqual([]);
    await expect(goalReportWorkAdapter.listVersionEvents({} as never)).resolves.toEqual([]);
    expect(() => goalReportWorkAdapter.mapCurrentRow({} as never)).toThrow(
      'goal_report Works are not listed',
    );
  });
});
