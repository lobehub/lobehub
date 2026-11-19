// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { projects, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { artboardRouter } from '../artboard';
import { createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));
// Board files live in object storage; these tests write none, so the folder is always empty.
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function FileService() {
    return { listFileObjects: async () => [] };
  }),
}));

const site = vi.hoisted(() => ({
  enabled: true,
  publishArtboardSite: vi.fn(),
  unpublishCanvasSite: vi.fn(),
}));

vi.mock('@/business/server/canvasPublish', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getArtboardViewerUrl: vi.fn(async () => 'https://static.example.com/artboard-viewer.js'),
  isCanvasPublishEnabled: () => site.enabled,
  publishArtboardSite: site.publishArtboardSite,
  unpublishCanvasSite: site.unpublishCanvasSite,
}));

describe('artboardRouter · publish', () => {
  let userId: string;
  let topicId: string;

  beforeEach(async () => {
    site.enabled = true;
    site.publishArtboardSite.mockReset().mockResolvedValue({
      deploymentId: 'dep_1',
      url: 'https://onboarding.lobe.page',
    });
    site.unpublishCanvasSite.mockReset().mockResolvedValue(undefined);
    testDB = await getTestDB();
    userId = await createTestUser(testDB);
    const projectId = `prj_${userId}`;
    topicId = `tpc_${userId}`;
    await testDB.insert(projects).values({ id: projectId, name: 'Onboarding', userId });
    await testDB.insert(topics).values({ id: topicId, projectId, title: '讨论', userId });
  });

  const caller = () => artboardRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  const createBoard = (board: Record<string, unknown> = { type: 'decision' }) =>
    caller().create({
      ops: [{ board: { title: '选一个方向', x: 0, y: 0, ...board }, ref: 'b', type: 'addBoard' }],
      title: '首次进入',
      topicId,
    });

  it('refuses to publish where publishing is unavailable', async () => {
    site.enabled = false;
    const { artboard } = await createBoard();

    await expect(caller().publish({ id: artboard.id })).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });
    expect(await caller().getPublish({ id: artboard.id })).toMatchObject({ canPublish: false });
  });

  it('publishes the board and reports the link', async () => {
    const { artboard } = await createBoard();
    await caller().addComment({ clientId: 'c1', content: '内部讨论不要外传', id: artboard.id });

    const result = await caller().publish({ id: artboard.id });

    expect(result).toEqual({ url: 'https://onboarding.lobe.page' });
    const [params] = site.publishArtboardSite.mock.calls[0];
    expect(params).toMatchObject({ artboardId: artboard.id, title: '首次进入', userId });
    expect(params.bundle.html).toContain('选一个方向');
    expect(params.bundle.html).not.toContain('内部讨论不要外传');
    expect(await caller().getPublish({ id: artboard.id })).toEqual({
      canPublish: true,
      hasUpdates: false,
      publishedUrl: 'https://onboarding.lobe.page',
    });
  });

  it('reports updates after the board changes, and republishes to the same deployment', async () => {
    const { artboard } = await createBoard();
    await caller().publish({ id: artboard.id });
    const boardId = artboard.content.boards[0].id;

    await caller().update({
      id: artboard.id,
      ops: [{ id: boardId, patch: { title: '换一个方向' }, type: 'updateBoard' }],
      revision: 1,
    });

    expect(await caller().getPublish({ id: artboard.id })).toMatchObject({ hasUpdates: true });
    await caller().publish({ id: artboard.id });
    expect(site.publishArtboardSite.mock.calls[1][0]).toMatchObject({ deploymentId: 'dep_1' });
    expect(await caller().getPublish({ id: artboard.id })).toMatchObject({ hasUpdates: false });
  });

  it('takes the share offline', async () => {
    const { artboard } = await createBoard();
    await caller().publish({ id: artboard.id });

    await caller().unpublish({ id: artboard.id });

    expect(site.unpublishCanvasSite).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: 'dep_1', userId }),
    );
    expect(await caller().getPublish({ id: artboard.id })).toMatchObject({ publishedUrl: null });
  });
});
