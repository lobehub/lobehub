import { createMediaFileItemsFromMessage } from '@lobechat/builtin-tool-lobe-agent';
import type {
  ArtboardFrameSource,
  ArtboardFrameSourceInput,
  ArtboardOp,
  ResolvedArtboardOp,
} from '@lobechat/types';

import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { WorkModel } from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

import { ArtboardServiceError } from './errors';

export interface ArtboardCanvasInfo {
  title: string;
  version: number;
}

export interface ArtboardSourceResolver {
  canvas: (canvasId: string) => Promise<ArtboardCanvasInfo | undefined>;
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

const MEDIA_REF_PATTERN = /^msg_[\da-z]+\.(?:audio|image|video)_\d+$/;

export const createArtboardSourceResolver = (
  db: LobeChatDatabase,
  scope: ArtboardSourceScope,
): ArtboardSourceResolver => {
  const { userId, workspaceId } = scope;
  const files = new FileModel(db, userId, workspaceId);
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
      const found = await new WorkModel(db, userId, workspaceId).findCanvas(canvasId);
      return found
        ? { title: found.work.title ?? canvasId, version: found.version.version }
        : undefined;
    },
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
  source: ArtboardFrameSourceInput,
  sources: ArtboardSourceResolver,
  opIndex: number,
): Promise<ArtboardFrameSource> => {
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
  if (source.version !== undefined && source.version > canvas.version)
    throw new ArtboardServiceError(
      'invalid',
      `Canvas "${source.canvasId}" has no version ${source.version}; its latest is ${canvas.version}.`,
      { opIndex },
    );
  return {
    canvasId: source.canvasId,
    kind: 'canvas',
    ...(source.path ? { path: source.path } : {}),
    version: source.version ?? canvas.version,
  };
};

export const resolveOpSources = (
  ops: ArtboardOp[],
  sources: ArtboardSourceResolver,
): Promise<ResolvedArtboardOp[]> =>
  Promise.all(
    ops.map(async (op, index): Promise<ResolvedArtboardOp> => {
      if (op.type === 'addFrame')
        return {
          ...op,
          frame: { ...op.frame, source: await resolveSource(op.frame.source, sources, index) },
        };
      if (op.type === 'updateFrame' && op.patch.source)
        return {
          ...op,
          patch: { ...op.patch, source: await resolveSource(op.patch.source, sources, index) },
        };
      return op as ResolvedArtboardOp;
    }),
  );
