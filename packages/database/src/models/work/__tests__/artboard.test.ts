// @vitest-environment node
import type { RegisterArtboardWorkParams } from '@lobechat/types';
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
  userId2,
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
  toolIdentifier: 'builtin-artboard',
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
    await new ArtboardModel(serverDB, userId).delete(artboardId);

    expect((await model.listByWorkspace({ includeArtboardWorks: true })).items).toEqual([]);
  });
});

describe('WorkModel · artboard publish', () => {
  const publish = {
    deploymentId: 'dep_1',
    publishedRevision: 4,
    publisherUserId: userId,
    snapshotHash: 'hash_1',
    url: 'https://board.lobe.page',
  };

  it('records the share on the Work and finds it again', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerArtboard(params());

    await model.recordArtboardPublish(artboardId, publish);
    const work = await model.findArtboardWork(artboardId);

    expect(work?.url).toBe('https://board.lobe.page');
    expect(work?.metadata?.artboardPublish).toEqual({
      deploymentId: 'dep_1',
      publishedRevision: 4,
      publisherUserId: userId,
      snapshotHash: 'hash_1',
    });
  });

  it('keeps the share link when the board registers a new version', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerArtboard(params());
    await model.recordArtboardPublish(artboardId, publish);

    await model.registerArtboard(
      params({ changeType: 'updated', rootOperationId: null, toolCallId: 'call-artboard-2' }),
    );
    const work = await model.findArtboardWork(artboardId);

    expect(work?.url).toBe('https://board.lobe.page');
    expect(work?.metadata?.artboardPublish?.deploymentId).toBe('dep_1');
  });

  it('clears the share and nothing else', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerArtboard(params());
    await model.recordArtboardPublish(artboardId, publish);

    await model.clearArtboardPublish(artboardId);
    const work = await model.findArtboardWork(artboardId);

    expect(work?.url).toBeNull();
    expect(work?.metadata?.artboardPublish).toBeUndefined();
    expect(work?.title).toBe('新用户首次进入项目');
  });

  it('does not let another user record a share on the Work', async () => {
    await new WorkModel(serverDB, userId).registerArtboard(params());

    const row = await new WorkModel(serverDB, userId2).recordArtboardPublish(artboardId, publish);

    expect(row).toBeNull();
    expect((await new WorkModel(serverDB, userId).findArtboardWork(artboardId))?.url).toBeNull();
  });

  it('maps deployments back to their boards', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerArtboard(params());
    await model.recordArtboardPublish(artboardId, publish);

    expect(await model.findArtboardIdsByDeploymentIds(['dep_1', 'dep_missing'])).toEqual({
      dep_1: artboardId,
    });
    expect(await model.findArtboardIdsByDeploymentIds([])).toEqual({});
  });
});
