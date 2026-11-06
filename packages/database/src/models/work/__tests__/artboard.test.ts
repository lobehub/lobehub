// @vitest-environment node
import { EMPTY_ARTBOARD_CONTENT, type RegisterArtboardWorkParams } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { projects, projectWorks, tasks } from '../../../schemas';
import { ArtboardModel } from '../../artboard';
import { WorkModel } from '..';
import {
  agentId,
  cleanupWorkTestData,
  seedWorkTestData,
  serverDB,
  threadId,
  topicId,
  userId,
} from './_fixtures';

const projectId = 'prj_artboard_work';
let artboardId: string;

beforeEach(async () => {
  await seedWorkTestData();
  await serverDB.insert(projects).values({ id: projectId, name: 'Onboarding', userId });
  await serverDB.insert(tasks).values({
    createdByUserId: userId,
    id: 'task_artboard_work',
    identifier: 'T-1',
    instruction: 'design onboarding',
    seq: 1,
  });
  const board = await new ArtboardModel(serverDB, userId).create({
    content: EMPTY_ARTBOARD_CONTENT,
    projectId,
    taskId: 'task_artboard_work',
    title: '新用户首次进入项目',
  });
  artboardId = board.id;
});

afterEach(async () => {
  await serverDB.delete(tasks).where(eq(tasks.id, 'task_artboard_work'));
  await cleanupWorkTestData();
});

const params = (
  overrides: Partial<RegisterArtboardWorkParams> = {},
): RegisterArtboardWorkParams => ({
  agentId,
  artboardId,
  changeType: 'created',
  description: '3 组 · 10 个画面',
  projectId,
  rootOperationId: 'op-artboard-1',
  threadId,
  title: '新用户首次进入项目',
  toolCallId: 'call-artboard-1',
  toolIdentifier: 'lobe-artboard',
  toolName: 'createArtboard',
  topicId,
  ...overrides,
});

describe('WorkModel · artboard', () => {
  it('registers an artboard Work and binds it to the project', async () => {
    const model = new WorkModel(serverDB, userId);
    const work = await model.registerArtboard(params());

    expect(work).toMatchObject({
      resourceId: artboardId,
      resourceType: 'artboard',
      title: '新用户首次进入项目',
      type: 'artboard',
    });
    const bindings = await serverDB
      .select()
      .from(projectWorks)
      .where(eq(projectWorks.projectId, projectId));
    expect(bindings.map((b) => b.workId)).toEqual([work.id]);
  });

  it('appends a version on finalize without a second project binding', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerArtboard(params());
    await model.registerArtboard(
      params({ changeType: 'updated', rootOperationId: null, toolCallId: null }),
    );

    const page = await model.listByWorkspace({ includeArtboardWorks: true, type: 'artboard' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].version.version).toBe(2);
    const bindings = await serverDB
      .select()
      .from(projectWorks)
      .where(eq(projectWorks.projectId, projectId));
    expect(bindings).toHaveLength(1);
  });

  it('hides artboard Works from clients that did not opt in, even with includeFileWorks', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerArtboard(params());

    const fileOnly = await model.listSummariesByRootOperations({
      includeFileWorks: true,
      rootOperationIds: ['op-artboard-1'],
    });
    expect(fileOnly['op-artboard-1'] ?? []).toEqual([]);
    expect((await model.listByWorkspace({ includeFileWorks: true })).items).toEqual([]);
    expect(await model.listByConversation({ includeFileWorks: true, topicId })).toEqual([]);

    const optedIn = await model.listSummariesByRootOperations({
      includeArtboardWorks: true,
      includeFileWorks: true,
      rootOperationIds: ['op-artboard-1'],
    });
    expect(optedIn['op-artboard-1']).toHaveLength(1);
    expect(optedIn['op-artboard-1'][0]).toMatchObject({ type: 'artboard' });
  });

  it('drops the Work from the gallery once its board is gone', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerArtboard(params());
    await serverDB.delete(tasks).where(eq(tasks.id, 'task_artboard_work'));

    expect((await model.listByWorkspace({ includeArtboardWorks: true })).items).toEqual([]);
  });
});
