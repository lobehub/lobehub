import { CANVAS_ENTRY } from '@lobechat/canvas';
import { ARTBOARD_VIEWER_MAJOR, type ArtboardItem } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';

import {
  getArtboardViewerUrl,
  getCanvasPublishRuntimeUrl,
  isCanvasPublishEnabled,
  publishArtboardSite,
} from '@/business/server/canvasPublish';
import { FileModel } from '@/database/models/file';
import { WorkModel } from '@/database/models/work';
import type { ArtboardWork } from '@/database/models/work/artboard';
import type { LobeChatDatabase } from '@/database/type';
import { createCanvasStorageService } from '@/server/services/canvas';
import { buildCanvasPublishBundle } from '@/server/services/canvas/publish';
import { FileService } from '@/server/services/file';

import { ARTBOARD_TOOL_IDENTIFIER, ArtboardService, describeArtboard } from '..';
import { ARTBOARD_SOURCE_CONCURRENCY } from '../sources';
import {
  type ArtboardPublishCanvasBundle,
  type ArtboardPublishImage,
  buildArtboardPublishBundle,
} from './bundle';
import { type ArtboardShareOwner, unpublishArtboardWork } from './offline';
import { buildArtboardPublishSnapshot, hashArtboardSnapshot } from './snapshot';

export { unpublishArtboardWork } from './offline';

export interface ArtboardPublishDeps {
  loadArtboard: (id: string) => Promise<ArtboardItem>;
  loadCanvas: (
    canvasId: string,
    version: number,
  ) => Promise<ArtboardPublishCanvasBundle | undefined>;
  loadImage: (fileId: string) => Promise<ArtboardPublishImage | undefined>;
}

export interface ArtboardPublishState {
  canPublish: boolean;
  hasUpdates: boolean;
  publishedUrl: string | null;
}

const precondition = (message: string) => new TRPCError({ code: 'PRECONDITION_FAILED', message });

const createDefaultDeps = ({
  db,
  userId,
  workspaceId,
}: ArtboardShareOwner): ArtboardPublishDeps => {
  const workModel = new WorkModel(db, userId, workspaceId);
  const runtimeUrls = new Map<number, Promise<string | undefined>>();
  const runtimeUrl = (major: number) => {
    if (!runtimeUrls.has(major)) runtimeUrls.set(major, getCanvasPublishRuntimeUrl(major));
    return runtimeUrls.get(major)!;
  };

  return {
    loadArtboard: async (id) =>
      (await new ArtboardService(db, userId, workspaceId).get(id)).artboard,
    loadCanvas: async (canvasId, version) => {
      const current = await workModel.findCanvas(canvasId);
      if (!current) return;
      const versionRow =
        version === current.version.version
          ? current.version
          : await workModel.findCanvasVersion(current.work.id, version);
      const canvas = versionRow?.metadata?.canvas;
      if (!canvas) return;
      const url = await runtimeUrl(canvas.runtimeMajor);
      if (!url) throw precondition('The publication host has no compatible Canvas runtime');
      const storage = createCanvasStorageService(db, current.work.userId, workspaceId);
      const manifest = await storage.readManifest(canvas.manifestKey);
      return {
        bundle: await buildCanvasPublishBundle(storage, manifest, url),
        canvasId,
        entry: manifest.entry || CANVAS_ENTRY,
        version,
      };
    },
    loadImage: async (fileId) => {
      const file = await new FileModel(db, userId, workspaceId).findById(fileId);
      if (!file) return;
      try {
        const bytes = await new FileService(db, userId, workspaceId).getFileByteArray(file.url);
        return { bytes, contentType: file.fileType, fileId };
      } catch (error) {
        console.error('[artboard:publish] image unreadable', fileId, error);
        return;
      }
    },
  };
};

export class ArtboardPublishService {
  private workModel: WorkModel;
  private deps: ArtboardPublishDeps;

  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
    deps: Partial<ArtboardPublishDeps> = {},
  ) {
    this.workModel = new WorkModel(db, userId, workspaceId);
    this.deps = { ...createDefaultDeps({ db, userId, workspaceId }), ...deps };
  }

  // works.userId follows whoever registered the board last; the deployment lives with the publisher.
  private owns = (work: ArtboardWork | null) => {
    const publisher = work?.metadata?.artboardPublish?.publisherUserId;
    return !publisher || publisher === this.userId;
  };

  async getPublish(id: string): Promise<ArtboardPublishState> {
    const artboard = await this.deps.loadArtboard(id);
    const work = await this.workModel.findArtboardWork(id);
    const canPublish = isCanvasPublishEnabled() && this.owns(work);
    const publish = work?.metadata?.artboardPublish;
    if (!publish || !work?.url) return { canPublish, hasUpdates: false, publishedUrl: null };

    const hash = hashArtboardSnapshot(buildArtboardPublishSnapshot(artboard, { publishedAt: '' }));
    return { canPublish, hasUpdates: hash !== publish.snapshotHash, publishedUrl: work.url };
  }

  async publish(id: string): Promise<{ url: string }> {
    if (!isCanvasPublishEnabled())
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Artboard publishing is unavailable',
      });

    const artboard = await this.deps.loadArtboard(id);
    const work = await this.workModel.findArtboardWork(id);
    if (!this.owns(work))
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only the person who owns this artboard can share it',
      });

    const missing = artboard.content.boards.find(
      (board) => !board.source && board.type !== 'decision',
    );
    if (missing) throw precondition(`Board "${missing.title}" has no Canvas or image to publish`);

    const viewerUrl = await getArtboardViewerUrl(ARTBOARD_VIEWER_MAJOR);
    if (!viewerUrl) throw precondition('The publication host has no compatible artboard viewer');

    const snapshot = buildArtboardPublishSnapshot(artboard, {
      publishedAt: new Date().toISOString(),
    });
    const [canvases, images] = await Promise.all([
      this.loadCanvases(artboard),
      this.loadImages(artboard),
    ]);
    const bundle = buildArtboardPublishBundle({ canvases, images, snapshot, viewerUrl });

    if (!work)
      await this.workModel.registerArtboard({
        artboardId: id,
        changeType: 'created',
        description: describeArtboard(artboard.content),
        projectId: artboard.projectId,
        title: artboard.title,
        toolIdentifier: ARTBOARD_TOOL_IDENTIFIER,
        toolName: 'publishArtboard',
      });

    const site = await publishArtboardSite({
      artboardId: id,
      bundle,
      db: this.db,
      deploymentId: work?.metadata?.artboardPublish?.deploymentId,
      title: artboard.title,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    const recorded = await this.workModel.recordArtboardPublish(id, {
      deploymentId: site.deploymentId,
      publishedRevision: artboard.revision,
      publisherUserId: this.userId,
      snapshotHash: hashArtboardSnapshot(snapshot),
      url: site.url,
    });
    if (!recorded)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'The share was published but could not be recorded on the artboard',
      });
    return { url: site.url };
  }

  async unpublish(id: string): Promise<void> {
    await this.deps.loadArtboard(id);
    const work = await this.workModel.findArtboardWork(id);
    if (!work?.metadata?.artboardPublish) return;
    if (!this.owns(work))
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only the person who owns this artboard can stop sharing it',
      });

    await unpublishArtboardWork(
      { db: this.db, userId: this.userId, workspaceId: this.workspaceId },
      work,
    );
    await this.workModel.clearArtboardPublish(id);
  }

  private loadCanvases(artboard: ArtboardItem) {
    const refs = new Map<string, { canvasId: string; title: string; version: number }>();
    for (const board of artboard.content.boards)
      if (board.source?.kind === 'canvas') {
        const { canvasId, version } = board.source;
        const key = `${canvasId}@${version}`;
        if (!refs.has(key)) refs.set(key, { canvasId, title: board.title, version });
      }

    return pMap(
      [...refs.values()],
      async ({ canvasId, title, version }) => {
        const canvas = await this.deps.loadCanvas(canvasId, version);
        if (!canvas) throw precondition(`Board "${title}" points at a Canvas version that is gone`);
        return canvas;
      },
      { concurrency: ARTBOARD_SOURCE_CONCURRENCY },
    );
  }

  private loadImages(artboard: ArtboardItem) {
    const refs = new Map<string, string>();
    for (const board of artboard.content.boards)
      if (board.source?.kind === 'image' && !refs.has(board.source.fileId))
        refs.set(board.source.fileId, board.title);

    return pMap(
      [...refs.entries()],
      async ([fileId, title]) => {
        const image = await this.deps.loadImage(fileId);
        if (!image) throw precondition(`Board "${title}" points at an image that is gone`);
        return image;
      },
      { concurrency: ARTBOARD_SOURCE_CONCURRENCY },
    );
  }
}
