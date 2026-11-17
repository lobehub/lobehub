// @vitest-environment node
import type { ArtboardBoardView, ArtboardItem } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ArtboardPublishService } from '.';

const work = vi.hoisted(() => ({
  findArtboardWork: vi.fn(),
  recordArtboardPublish: vi.fn(),
  registerArtboard: vi.fn(),
}));

vi.mock('@/database/models/work', () => ({
  WorkModel: vi.fn(function WorkModel() {
    return work;
  }),
}));

const site = vi.hoisted(() => ({ publishArtboardSite: vi.fn() }));

vi.mock('@/business/server/canvasPublish', () => ({
  getArtboardViewerUrl: vi.fn(async () => 'https://static.example.com/artboard-viewer.js'),
  getCanvasPublishRuntimeUrl: vi.fn(),
  isCanvasPublishEnabled: () => true,
  publishArtboardSite: site.publishArtboardSite,
  unpublishCanvasSite: vi.fn(),
}));

const rect = { h: 400, w: 640, x: 0, y: 0 };

const board = (overrides: Partial<ArtboardBoardView>): ArtboardBoardView => ({
  expected: null,
  flowNodeId: null,
  groupId: null,
  id: 'brd_1',
  pageId: 'pg_1',
  rect,
  roundId: null,
  source: null,
  title: 'Board',
  type: 'decision',
  ...overrides,
});

const artboard = (boards: ArtboardBoardView[]): ArtboardItem => ({
  acceptanceId: null,
  content: { boards, edges: [], groups: [], pages: [], questions: [], rounds: [] },
  createdAt: new Date(),
  description: null,
  id: 'art_1',
  phase: 'discuss',
  projectId: 'prj_1',
  revision: 2,
  taskId: null,
  title: 'Onboarding',
  topicId: null,
  updatedAt: new Date(),
});

const service = (boards: ArtboardBoardView[], deps = {}) =>
  new ArtboardPublishService({} as any, 'user_1', undefined, {
    loadArtboard: async () => artboard(boards),
    loadCanvas: async () => undefined,
    loadImage: async () => undefined,
    ...deps,
  });

beforeEach(() => {
  work.findArtboardWork.mockReset().mockResolvedValue(null);
  work.recordArtboardPublish.mockReset();
  work.registerArtboard.mockReset();
  site.publishArtboardSite
    .mockReset()
    .mockResolvedValue({ deploymentId: 'dep_1', url: 'https://x' });
});

describe('ArtboardPublishService', () => {
  it('refuses a member who does not own the Work', async () => {
    work.findArtboardWork.mockResolvedValue({ metadata: null, url: null, userId: 'user_2' });

    await expect(service([board({})]).publish('art_1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await service([board({})]).getPublish('art_1')).toMatchObject({ canPublish: false });
  });

  it('names the board whose source is gone', async () => {
    const boards = [board({ title: 'Checkout', type: 'html' })];

    await expect(service(boards).publish('art_1')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('Checkout'),
    });
    expect(site.publishArtboardSite).not.toHaveBeenCalled();
  });

  it('names the board whose Canvas version cannot be read', async () => {
    const boards = [
      board({
        source: { canvasId: 'cvs_1', kind: 'canvas', version: 2 },
        title: 'Pricing',
        type: 'html',
      }),
    ];

    await expect(service(boards).publish('art_1')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('Pricing'),
    });
  });

  it('ships each Canvas version once and every image, then records the share', async () => {
    const loadCanvas = vi.fn(async (canvasId: string, version: number) => ({
      bundle: { files: [], html: `<p>${canvasId}</p>` },
      canvasId,
      entry: 'index.html',
      version,
    }));
    const loadImage = vi.fn(async (fileId: string) => ({
      bytes: new Uint8Array([1]),
      contentType: 'image/png',
      fileId,
    }));
    const canvas = { canvasId: 'cvs_1', kind: 'canvas' as const, version: 2 };
    const boards = [
      board({ id: 'a', source: canvas, type: 'html' }),
      board({ id: 'b', source: canvas, type: 'html' }),
      board({ id: 'c', source: { fileId: 'file_1', kind: 'image' }, type: 'image' }),
    ];

    await service(boards, { loadCanvas, loadImage }).publish('art_1');

    expect(loadCanvas).toHaveBeenCalledTimes(1);
    const { bundle } = site.publishArtboardSite.mock.calls[0][0];
    expect(bundle.files.map((file: { path: string }) => file.path).toSorted()).toEqual([
      '/canvases/cvs_1/v2/index.html',
      '/images/file_1',
    ]);
    expect(work.registerArtboard).toHaveBeenCalledWith(
      expect.objectContaining({ artboardId: 'art_1', toolName: 'publishArtboard' }),
    );
    expect(work.recordArtboardPublish).toHaveBeenCalledWith(
      'art_1',
      expect.objectContaining({ deploymentId: 'dep_1', publishedRevision: 2, url: 'https://x' }),
    );
  });
});
