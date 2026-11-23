// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ArtboardModel } from '@/database/models/artboard';
import { WorkModel } from '@/database/models/work';
import { projects, users } from '@/database/schemas';

import { workRouter } from '../work';

const serverDB = await getTestDB();
const unpublishCanvasSite = vi.hoisted(() => vi.fn());

vi.mock('@/business/server/canvasPublish', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  unpublishCanvasSite,
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: trpc.procedure };
});

vi.mock('@/business/server/trpc-middlewares/rbacPermission', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { withScopedPermission: () => trpc.middleware((opts) => opts.next()) };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: { next: (input: unknown) => unknown }) =>
    opts.next({ ctx: { serverDB } }),
}));

const userId = 'work-artboard-share-user';
const projectId = 'prj_work_artboard_share';
const caller = () => workRouter.createCaller({ serverDB, userId });

const publishedArtboardWork = async (publisherUserId = userId) => {
  const board = await new ArtboardModel(serverDB, userId).create({
    projectId,
    title: 'Onboarding',
  });
  const model = new WorkModel(serverDB, userId);
  const work = await model.registerArtboard({
    artboardId: board.id,
    changeType: 'created',
    title: 'Onboarding',
    toolIdentifier: 'builtin-artboard',
    toolName: 'createArtboard',
  });
  await model.recordArtboardPublish(board.id, {
    deploymentId: 'dep_artboard',
    publishedRevision: 1,
    publisherUserId,
    snapshotHash: 'hash',
    url: 'https://onboarding.lobe.page',
  });
  return { artboardId: board.id, model, workId: work.id };
};

beforeEach(async () => {
  unpublishCanvasSite.mockReset().mockResolvedValue(undefined);
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(projects).values({ id: projectId, name: 'Onboarding', userId });
});

describe('workRouter.deleteWork · published artboard', () => {
  it('takes the share offline before removing the Work card', async () => {
    const { artboardId, model, workId } = await publishedArtboardWork();

    await caller().deleteWork({ id: workId });

    expect(unpublishCanvasSite).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: 'dep_artboard', userId }),
    );
    expect(await model.findArtboardWork(artboardId)).toBeNull();
  });

  it('keeps the Work card when the share cannot be taken offline', async () => {
    unpublishCanvasSite.mockRejectedValue(new Error('market down'));
    const { artboardId, model, workId } = await publishedArtboardWork();

    await expect(caller().deleteWork({ id: workId })).rejects.toThrow();

    expect((await model.findArtboardWork(artboardId))?.url).toBe('https://onboarding.lobe.page');
  });

  it('takes the share offline as the person who published it', async () => {
    const { workId } = await publishedArtboardWork('work-artboard-share-publisher');

    await caller().deleteWork({ id: workId });

    expect(unpublishCanvasSite).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'work-artboard-share-publisher' }),
    );
  });
});
