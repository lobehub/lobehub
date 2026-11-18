import { ARTBOARD_VIEWER_MAJOR, type ArtboardItem } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';

import {
  getArtboardViewerUrl,
  isCanvasPublishEnabled,
  publishArtboardSite,
} from '@/business/server/canvasPublish';
import { WorkModel } from '@/database/models/work';
import type { ArtboardWork } from '@/database/models/work/artboard';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

import { ARTBOARD_TOOL_IDENTIFIER, ArtboardService, describeArtboard } from '..';
import { artboardFileKey, createFileServiceArtboardBlobStore } from '../files';
import { ARTBOARD_SOURCE_CONCURRENCY } from '../sources';
import { buildArtboardPublishBundle } from './bundle';
import { type ArtboardShareOwner, unpublishArtboardWork } from './offline';
import {
  type ArtboardPublishFileRef,
  buildArtboardPublishSnapshot,
  hashArtboardSnapshot,
} from './snapshot';

export { unpublishArtboardWork } from './offline';

export interface ArtboardPublishFileRow extends ArtboardPublishFileRef {
  contentType: string;
}

export interface ArtboardPublishDeps {
  listFiles: (id: string) => Promise<ArtboardPublishFileRow[]>;
  loadArtboard: (id: string) => Promise<ArtboardItem>;
  /** Bytes of one artboard file, or undefined when the object store can no longer read it. */
  readFile: (id: string, path: string) => Promise<Uint8Array | undefined>;
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
  const artboards = new ArtboardService(db, userId, workspaceId);
  const store = createFileServiceArtboardBlobStore(() => new FileService(db, userId, workspaceId));

  return {
    listFiles: (id) => artboards.listFiles(id),
    loadArtboard: async (id) => (await artboards.get(id)).artboard,
    // Only reached after listFiles(id) checked the artboard is visible to this user.
    readFile: async (id, path) => {
      try {
        return await store.read(artboardFileKey(id, path));
      } catch (error) {
        console.error('[artboard:publish] file unreadable', id, path, error);
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

    const hash = hashArtboardSnapshot(
      buildArtboardPublishSnapshot(artboard, { publishedAt: '' }),
      await this.deps.listFiles(id),
    );
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
    if (missing) throw precondition(`Board "${missing.title}" has no file to publish`);

    // A board whose file is missing is published as is; the viewer shows it as missing.
    const rows = await this.deps.listFiles(id);

    const viewerUrl = await getArtboardViewerUrl(ARTBOARD_VIEWER_MAJOR);
    if (!viewerUrl) throw precondition('The publication host has no compatible artboard viewer');

    const files = await pMap(
      rows,
      async ({ contentType, path }) => {
        const bytes = await this.deps.readFile(id, path);
        if (!bytes) throw precondition(`Artboard file "${path}" can no longer be read`);
        return { bytes, contentType, path };
      },
      { concurrency: ARTBOARD_SOURCE_CONCURRENCY },
    );
    const snapshot = buildArtboardPublishSnapshot(artboard, {
      publishedAt: new Date().toISOString(),
    });
    const bundle = buildArtboardPublishBundle({ files, snapshot, viewerUrl });

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
      snapshotHash: hashArtboardSnapshot(snapshot, rows),
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
}
