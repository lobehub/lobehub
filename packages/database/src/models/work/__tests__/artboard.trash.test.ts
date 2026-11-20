// @vitest-environment node
import type { RegisterArtboardWorkParams } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { works } from '../../../schemas';
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

let artboardId: string;
let otherArtboardId: string;

const params = (
  target: string,
  overrides: Partial<RegisterArtboardWorkParams> = {},
): RegisterArtboardWorkParams => ({
  agentId,
  artboardId: target,
  changeType: 'created',
  projectId: null,
  rootOperationId: 'op-artboard-trash',
  threadId,
  title: '新用户首次进入项目',
  toolCallId: 'call-artboard-trash',
  toolIdentifier: 'builtin-artboard',
  toolName: 'createArtboard',
  topicId,
  ...overrides,
});

beforeEach(async () => {
  await seedWorkTestData();
  const artboards = new ArtboardModel(serverDB, userId);
  artboardId = (await artboards.create({ title: '新用户首次进入项目' })).id;
  otherArtboardId = (await artboards.create({ title: '结算流程' })).id;
});

afterEach(cleanupWorkTestData);

const publish = {
  deploymentId: 'dep_trash',
  publishedRevision: 2,
  publisherUserId: userId,
  snapshotHash: 'hash_trash',
  url: 'https://board.lobe.page',
};

describe('WorkModel · artboard recycle bin', () => {
  it('finds the Works of the boards being trashed and nothing for an empty list', async () => {
    const model = new WorkModel(serverDB, userId);
    const work = await model.registerArtboard(params(artboardId));

    expect(await model.findArtboardWorksForTrash([])).toEqual([]);

    const found = await model.findArtboardWorksForTrash([artboardId, otherArtboardId]);
    expect(found.map((row) => row.id)).toEqual([work.id]);
    expect(found[0]).toMatchObject({ resourceId: artboardId, resourceType: 'artboard' });
  });

  it('takes the share down with the trashed boards and leaves the rest of the Work alone', async () => {
    const model = new WorkModel(serverDB, userId);
    const work = await model.registerArtboard(params(artboardId));
    await model.recordArtboardPublish(artboardId, publish);

    await model.clearArtboardPublishForTrash([]);
    expect((await model.findArtboardWork(artboardId))?.url).toBe('https://board.lobe.page');

    await model.clearArtboardPublishForTrash([artboardId]);
    const [row] = await serverDB.select().from(works).where(eq(works.id, work.id));
    expect(row.url).toBeNull();
    expect(row.metadata?.artboardPublish).toBeUndefined();
    expect(row.title).toBe('新用户首次进入项目');
  });

  it('removes the Works of the boards being purged and nothing for an empty list', async () => {
    const model = new WorkModel(serverDB, userId);
    const work = await model.registerArtboard(params(artboardId));
    const kept = await model.registerArtboard(params(otherArtboardId));

    await model.deleteArtboardWorksForTrash([]);
    expect(await serverDB.select().from(works).where(eq(works.id, work.id))).toHaveLength(1);

    await model.deleteArtboardWorksForTrash([artboardId]);
    expect(await serverDB.select().from(works).where(eq(works.id, work.id))).toEqual([]);
    expect(await serverDB.select().from(works).where(eq(works.id, kept.id))).toHaveLength(1);
  });

  it('finds a board Work by its Work id, and only for artboards', async () => {
    const model = new WorkModel(serverDB, userId);
    const work = await model.registerArtboard(params(artboardId));

    expect(await model.findArtboardWorkByWorkId(work.id)).toMatchObject({ id: work.id });
    expect(await model.findArtboardWorkByWorkId('w_missing')).toBeNull();
  });
});
