// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { DocumentModel } from '@/database/models/document';
import { GoalModel } from '@/database/models/goal';
import { VerifyCriterionModel } from '@/database/models/verifyCriterion';
import { files, globalFiles, goalNodes, goals, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { GoalCopyService } from './copy';
import { GoalService } from './GoalService';
import { registerGoalServiceTestCleanup } from './testUtils';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-copy-test-user';
const workspaceId = 'goal-copy-test-ws';

registerGoalServiceTestCleanup(serverDB, userId);

beforeEach(async () => {
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Team', primaryOwnerId: userId, slug: 'goal-copy-team' })
    .onConflictDoNothing();
});

const problemNode = async (goalId: string) =>
  (
    await serverDB
      .select()
      .from(goalNodes)
      .where(and(eq(goalNodes.goalId, goalId), eq(goalNodes.kind, 'problem')))
  )[0];

describe('GoalCopyService.copyToWorkspace', () => {
  it('copies a personal goal definition into a workspace as a fresh, agent-less draft', async () => {
    const source = await new GoalService(serverDB, userId).create({
      config: {
        recovery: { maxAttemptsPerTask: 2 },
        schedule: { deadline: '2000-01-01T00:00:00.000Z' },
        supervision: { enabled: true, maxIncidents: 3 },
      },
      maxRounds: 5,
      maxTotalCost: 12.5,
      problemDescription: 'Ship the onboarding flow',
      requirement: 'Users can finish onboarding',
      tasks: ['Draft the copy'],
      title: 'Onboarding',
    });
    // Scope-bound fields a copy must not carry: they name the source's agent and run state.
    await serverDB
      .update(goals)
      .set({
        config: {
          ...source.goal.config,
          model: 'gpt-x',
          pausedBy: 'pattern_break',
          provider: 'openai',
          taskAgentId: 'agt_source_only',
        },
        status: 'running',
      })
      .where(eq(goals.id, source.goal.id));

    const { goalId } = await new GoalCopyService(serverDB, userId).copyToWorkspace(
      source.goal.id,
      workspaceId,
    );

    expect(goalId).not.toBe(source.goal.id);
    // The copy lands in the workspace, not in personal scope.
    expect(await new GoalModel(serverDB, userId).findById(goalId)).toBeUndefined();
    const copy = (await new GoalModel(serverDB, userId, workspaceId).findById(goalId))!;
    expect(copy).toMatchObject({
      agentId: null,
      maxRounds: 5,
      maxTotalCost: 12.5,
      projectId: null,
      requirement: 'Users can finish onboarding',
      status: 'draft',
      title: 'Onboarding',
      workspaceId,
    });
    expect(copy.config).toEqual({
      recovery: { maxAttemptsPerTask: 2 },
      supervision: { enabled: true, maxIncidents: 3 },
    });

    // A fresh graph: the problem statement only, none of the source's Tasks.
    const nodes = await serverDB.select().from(goalNodes).where(eq(goalNodes.goalId, goalId));
    expect(nodes.map((node) => node.kind)).toEqual(['problem']);
    expect((await problemNode(goalId))?.description).toBe('Ship the onboarding flow');

    // The source is untouched.
    const original = (await new GoalModel(serverDB, userId).findById(source.goal.id))!;
    expect(original.status).toBe('running');
    expect(original.config?.taskAgentId).toBe('agt_source_only');
  });

  it('clones acceptance criteria and their instructions into the target scope', async () => {
    const source = await new GoalService(serverDB, userId, workspaceId).create({
      config: { acceptance: { metrics: [{ key: 'signups', target: 100 }] } },
      criteria: [{ instruction: 'Open the page and sign up', title: 'Sign-up works' }],
      title: 'Grow sign-ups',
    });
    const sourceCriterionIds = source.goal.config!.acceptance!.criteriaIds!;

    const { goalId } = await new GoalCopyService(serverDB, userId, workspaceId).copyToWorkspace(
      source.goal.id,
      null,
    );

    const copy = (await new GoalModel(serverDB, userId).findById(goalId))!;
    expect(copy.workspaceId).toBeNull();
    expect(copy.config?.acceptance?.metrics).toEqual([{ key: 'signups', target: 100 }]);
    const copiedIds = copy.config!.acceptance!.criteriaIds!;
    expect(copiedIds).toHaveLength(1);
    expect(copiedIds[0]).not.toBe(sourceCriterionIds[0]);

    const [criterion] = await new VerifyCriterionModel(serverDB, userId).findByIds(copiedIds);
    expect(criterion).toMatchObject({ title: 'Sign-up works', workspaceId: null });
    const document = await new DocumentModel(serverDB, userId).findById(criterion.documentId!);
    expect(document?.content).toBe('Open the page and sign up');
    // The source criterion still belongs to the workspace goal.
    expect(
      await new VerifyCriterionModel(serverDB, userId, workspaceId).findByIds(sourceCriterionIds),
    ).toHaveLength(1);
  });

  it('re-points fixture resources at copies in the target scope', async () => {
    const source = await new GoalService(serverDB, userId, workspaceId).create({
      criteria: [{ instruction: 'Upload the sample and compare', title: 'Import works' }],
      title: 'Import data',
    });
    const [criterionId] = source.goal.config!.acceptance!.criteriaIds!;
    const sourceDocument = await new DocumentModel(serverDB, userId, workspaceId).create({
      content: 'name,email',
      fileType: 'text/csv',
      source: 'fixture.csv',
      sourceType: 'api',
      title: 'fixture.csv',
      totalCharCount: 10,
      totalLineCount: 1,
    });
    await serverDB
      .insert(globalFiles)
      .values({
        creator: userId,
        fileType: 'image/png',
        hashId: 'goal-copy-fixture-hash',
        size: 1,
        url: 'k-fx',
      })
      .onConflictDoNothing();
    await serverDB.insert(files).values({
      fileHash: 'goal-copy-fixture-hash',
      fileType: 'image/png',
      id: 'goal-copy-fixture-file',
      name: 'sample.png',
      size: 1,
      url: 'k-fx',
      userId,
      workspaceId,
    });
    await new VerifyCriterionModel(serverDB, userId, workspaceId).update(criterionId, {
      definition: {
        fixtures: [
          { id: 'csv', name: 'CSV', resource: { id: sourceDocument.id, type: 'document' } },
          { id: 'png', name: 'PNG', resource: { id: 'goal-copy-fixture-file', type: 'file' } },
          { id: 'gone', name: 'Gone', resource: { id: 'docs_missing', type: 'document' } },
          { data: { rows: 3 }, id: 'inline', name: 'Inline' },
        ],
      },
    });

    const service = new GoalCopyService(serverDB, userId, workspaceId);
    // The preflight lists only resources the copy will duplicate.
    expect(await service.fixtureResources(source.goal.id)).toEqual({
      documentIds: [sourceDocument.id],
      files: [{ id: 'goal-copy-fixture-file', size: 1 }],
    });

    const { goalId } = await service.copyToWorkspace(source.goal.id, null);

    const copy = (await new GoalModel(serverDB, userId).findById(goalId))!;
    const [criterion] = await new VerifyCriterionModel(serverDB, userId).findByIds(
      copy.config!.acceptance!.criteriaIds!,
    );
    const [csv, png, gone, inline] = criterion.definition!.fixtures!;
    expect(csv.resource!.id).not.toBe(sourceDocument.id);
    expect((await new DocumentModel(serverDB, userId).findById(csv.resource!.id))?.content).toBe(
      'name,email',
    );
    expect(png.resource!.id).not.toBe('goal-copy-fixture-file');
    const copiedFile = await serverDB.query.files.findFirst({
      where: eq(files.id, png.resource!.id),
    });
    expect(copiedFile).toMatchObject({ fileHash: 'goal-copy-fixture-hash', workspaceId: null });
    // An unreadable resource is dropped instead of pointing into the source scope.
    expect(gone.resource).toBeUndefined();
    expect(inline).toEqual({ data: { rows: 3 }, id: 'inline', name: 'Inline' });

    // The copied fixtures resolve in the copy's scope, as verification will.
    const [materialized] = await new VerifyCriterionModel(serverDB, userId).materialize(
      [
        {
          id: 'check_1',
          index: 0,
          onFail: criterion.onFail,
          required: criterion.required,
          sourceCriterionId: criterion.id,
          title: criterion.title,
          verifierConfig: criterion.verifierConfig ?? {},
          verifierType: criterion.verifierType,
        },
      ],
      'ctx_goal_copy',
    );
    expect(materialized.resourceSnapshot?.fixtures.map((f) => f.fixtureId)).toEqual(['csv', 'png']);
  });

  it('refuses a goal outside the caller scope', async () => {
    const source = await new GoalService(serverDB, userId, workspaceId).create({
      title: 'Workspace only',
    });

    await expect(
      new GoalCopyService(serverDB, userId).copyToWorkspace(source.goal.id, workspaceId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
