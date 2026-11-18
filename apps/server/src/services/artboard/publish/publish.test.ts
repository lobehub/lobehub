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

const fileRow = (path: string, hash = `h_${path}`) => ({
  contentType: path.endsWith('.png') ? 'image/png' : 'text/html',
  hash,
  path,
});

const htmlBoard = (id: string, path: string, title = 'Board') =>
  board({ id, source: { hash: `h_${path}`, kind: 'file', path }, title, type: 'html' });

const service = (boards: ArtboardBoardView[], deps = {}) =>
  new ArtboardPublishService({} as any, 'user_1', undefined, {
    listFiles: async () => [],
    loadArtboard: async () => artboard(boards),
    readFile: async () => new Uint8Array([1]),
    ...deps,
  });

beforeEach(() => {
  work.findArtboardWork.mockReset().mockResolvedValue(null);
  work.recordArtboardPublish.mockReset().mockResolvedValue({ id: 'work_1' });
  work.registerArtboard.mockReset();
  site.publishArtboardSite
    .mockReset()
    .mockResolvedValue({ deploymentId: 'dep_1', url: 'https://x' });
});

describe('ArtboardPublishService', () => {
  it('refuses a member who did not publish the share', async () => {
    work.findArtboardWork.mockResolvedValue({
      metadata: { artboardPublish: { deploymentId: 'dep_1', publisherUserId: 'user_2' } },
      url: 'https://x',
      userId: 'user_1',
    });

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

  it('publishes a board whose file is missing; the viewer shows it as missing', async () => {
    const boards = [htmlBoard('a', 'pages/gone.html', 'Pricing')];

    await service(boards).publish('art_1');

    expect(site.publishArtboardSite).toHaveBeenCalledTimes(1);
  });

  it('ships every artboard file once, then records the share', async () => {
    const listFiles = async () => [
      fileRow('pages/a.html'),
      fileRow('pages/app.css'),
      fileRow('shots/home.png'),
    ];
    const readFile = vi.fn(async () => new Uint8Array([1]));
    const boards = [
      htmlBoard('a', 'pages/a.html'),
      htmlBoard('b', 'pages/a.html'),
      board({
        id: 'c',
        source: { hash: 'h_shots/home.png', kind: 'file', path: 'shots/home.png' },
        type: 'image',
      }),
    ];

    await service(boards, { listFiles, readFile }).publish('art_1');

    expect(readFile).toHaveBeenCalledTimes(3);
    const { bundle } = site.publishArtboardSite.mock.calls[0][0];
    expect(bundle.files.map((file: { path: string }) => file.path).toSorted()).toEqual([
      '/files/pages/a.html',
      '/files/pages/app.css',
      '/files/shots/home.png',
    ]);
    expect(work.registerArtboard).toHaveBeenCalledWith(
      expect.objectContaining({ artboardId: 'art_1', toolName: 'publishArtboard' }),
    );
    expect(work.recordArtboardPublish).toHaveBeenCalledWith(
      'art_1',
      expect.objectContaining({ deploymentId: 'dep_1', publishedRevision: 2, url: 'https://x' }),
    );
  });

  it('reports updates once a file the shared pages load has changed', async () => {
    const boards = [htmlBoard('a', 'pages/a.html')];
    const published = [fileRow('pages/a.html'), fileRow('pages/app.css')];
    await service(boards, { listFiles: async () => published }).publish('art_1');
    const { snapshotHash } = work.recordArtboardPublish.mock.calls[0][1];
    work.findArtboardWork.mockResolvedValue({
      metadata: {
        artboardPublish: { deploymentId: 'dep_1', publisherUserId: 'user_1', snapshotHash },
      },
      url: 'https://x',
      userId: 'user_1',
    });

    const unchanged = await service(boards, { listFiles: async () => published }).getPublish(
      'art_1',
    );
    const restyled = await service(boards, {
      listFiles: async () => [published[0], fileRow('pages/app.css', 'h_css_2')],
    }).getPublish('art_1');

    expect(unchanged).toMatchObject({ hasUpdates: false });
    expect(restyled).toMatchObject({ hasUpdates: true });
  });

  it('lets the person who shared the board update it after someone else edited the board', async () => {
    work.findArtboardWork.mockResolvedValue({
      metadata: { artboardPublish: { deploymentId: 'dep_1', publisherUserId: 'user_1' } },
      url: 'https://x',
      userId: 'user_2',
    });

    await service([board({})]).publish('art_1');

    expect(site.publishArtboardSite).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: 'dep_1', userId: 'user_1' }),
    );
    expect(await service([board({})]).getPublish('art_1')).toMatchObject({ canPublish: true });
  });

  it('lets any editor share a board nobody has shared yet', async () => {
    work.findArtboardWork.mockResolvedValue({ metadata: null, url: null, userId: 'user_2' });

    await service([board({})]).publish('art_1');

    expect(work.recordArtboardPublish).toHaveBeenCalledWith(
      'art_1',
      expect.objectContaining({ publisherUserId: 'user_1' }),
    );
  });

  it('fails when the share could not be recorded on the Work', async () => {
    work.recordArtboardPublish.mockResolvedValue(null);

    await expect(service([board({})]).publish('art_1')).rejects.toThrow();
  });

  it('names the file that can no longer be read', async () => {
    const boards = [htmlBoard('a', 'pages/a.html', 'Moodboard')];

    await expect(
      service(boards, {
        listFiles: async () => [fileRow('pages/a.html')],
        readFile: async () => undefined,
      }).publish('art_1'),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('pages/a.html'),
    });
    expect(site.publishArtboardSite).not.toHaveBeenCalled();
  });
});
