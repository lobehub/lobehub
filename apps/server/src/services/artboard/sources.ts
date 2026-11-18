import { createMediaFileItemsFromMessage } from '@lobechat/builtin-tool-lobe-agent';
import type { ArtboardBoardSourceInput, ArtboardOp } from '@lobechat/types';
import pMap from 'p-map';

import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { WorkModel } from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

import { ArtboardServiceError } from './errors';

export const ARTBOARD_SOURCE_CONCURRENCY = 5;

export interface ArtboardCanvasInfo {
  title: string;
  version: number;
}

export interface ArtboardCanvasRef {
  canvasId: string;
  version: number;
}

export interface ArtboardSourceResolver {
  canvas: (canvasId: string) => Promise<ArtboardCanvasInfo | undefined>;
  canvasVersionId: (canvasId: string, version: number) => Promise<string | undefined>;
  canvasVersions: (versionIds: string[]) => Promise<Record<string, ArtboardCanvasRef>>;
  image: (fileRef: string) => Promise<string | undefined>;
  imageUrl: (fileId: string) => Promise<string | undefined>;
}

export interface ArtboardSourceScope {
  agentId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  userId: string;
  workspaceId?: string;
}

export type ResolvedBoardSource =
  | { kind: 'canvas'; path: string | null; workVersionId: string }
  | { fileId: string; kind: 'image' };

type WithResolvedSource<T> = T extends { board: infer B }
  ? Omit<T, 'board'> & { board: Omit<B, 'source'> & { source?: ResolvedBoardSource } }
  : T extends { patch: infer P; type: 'updateBoard' }
    ? Omit<T, 'patch'> & { patch: Omit<P, 'source'> & { source?: ResolvedBoardSource } }
    : T;

export type ResolvedArtboardOp = WithResolvedSource<ArtboardOp>;

const MEDIA_REF_PATTERN = /^msg_[\da-z]+\.(?:audio|image|video)_\d+$/;

export const createArtboardSourceResolver = (
  db: LobeChatDatabase,
  scope: ArtboardSourceScope,
): ArtboardSourceResolver => {
  const { userId, workspaceId } = scope;
  const files = new FileModel(db, userId, workspaceId);
  const works = new WorkModel(db, userId, workspaceId);
  let mediaFileIds: Promise<Map<string, string>> | undefined;

  const listMediaFileIds = async () => {
    if (!scope.topicId) return new Map<string, string>();
    const messages = await new MessageModel(db, userId, workspaceId).query({
      agentId: scope.agentId ?? undefined,
      skipWorks: true,
      threadId: scope.threadId ?? undefined,
      topicId: scope.topicId,
    });
    return new Map(
      messages
        .flatMap((message) => createMediaFileItemsFromMessage(message))
        .flatMap((item) => (item.id ? [[item.ref, item.id] as const] : [])),
    );
  };

  return {
    canvas: async (canvasId) => {
      const found = await works.findCanvas(canvasId);
      return found
        ? { title: found.work.title ?? canvasId, version: found.version.version }
        : undefined;
    },
    canvasVersionId: async (canvasId, version) =>
      (await works.findCanvasVersionId(canvasId, version)) ?? undefined,
    canvasVersions: (versionIds) => works.findCanvasSourcesByVersionIds(versionIds),
    image: async (fileRef) => {
      let fileId: string | undefined = fileRef;
      if (MEDIA_REF_PATTERN.test(fileRef)) {
        const pending = (mediaFileIds ??= listMediaFileIds());
        fileId = (await pending).get(fileRef);
      }
      if (!fileId) return;
      const file = await files.findById(fileId);
      return file?.fileType.startsWith('image/') ? file.id : undefined;
    },
    imageUrl: async (fileId) => {
      const file = await files.findById(fileId);
      if (!file) return;
      return new FileService(db, userId, workspaceId).getFileAccessUrl({
        id: file.id,
        url: file.url,
      });
    },
  };
};

const resolveSource = async (
  source: ArtboardBoardSourceInput,
  sources: ArtboardSourceResolver,
  opIndex: number,
): Promise<ResolvedBoardSource> => {
  if (source.kind === 'image') {
    const fileId = await sources.image(source.fileRef);
    if (!fileId)
      throw new ArtboardServiceError(
        'source_denied',
        `fileRef "${source.fileRef}" does not match an image you can access. Use a file id from <file id> or an image ref from <image ref> in this conversation.`,
        { opIndex },
      );
    return { fileId, kind: 'image' };
  }

  const canvas = await sources.canvas(source.canvasId);
  if (!canvas)
    throw new ArtboardServiceError(
      'source_denied',
      `Canvas "${source.canvasId}" was not found or you cannot access it.`,
      { opIndex },
    );
  const version = source.version ?? canvas.version;
  const workVersionId =
    version > canvas.version ? undefined : await sources.canvasVersionId(source.canvasId, version);
  if (!workVersionId)
    throw new ArtboardServiceError(
      'invalid',
      `Canvas "${source.canvasId}" has no version ${version}; its latest is ${canvas.version}.`,
      { opIndex },
    );
  return { kind: 'canvas', path: source.path ?? null, workVersionId };
};

export const resolveOpSources = (
  ops: ArtboardOp[],
  sources: ArtboardSourceResolver,
): Promise<ResolvedArtboardOp[]> =>
  pMap(
    ops,
    async (op, index): Promise<ResolvedArtboardOp> => {
      if (op.type === 'addBoard') {
        const { source, ...board } = op.board;
        return {
          ...op,
          board: source ? { ...board, source: await resolveSource(source, sources, index) } : board,
        };
      }
      if (op.type === 'updateBoard') {
        const { source, ...patch } = op.patch;
        return {
          ...op,
          patch: source ? { ...patch, source: await resolveSource(source, sources, index) } : patch,
        };
      }
      return op;
    },
    { concurrency: ARTBOARD_SOURCE_CONCURRENCY },
  );
