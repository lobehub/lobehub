import { createMediaFileItemsFromMessage } from '@lobechat/builtin-tool-lobe-agent';

import { getCanvasPublishRuntimeUrl } from '@/business/server/canvasPublish';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { WorkModel } from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';
import { createCanvasStorageService } from '@/server/services/canvas';
import { buildCanvasPublishBundle } from '@/server/services/canvas/publish';
import { FileService } from '@/server/services/file';

import type { ArtboardImageBytes, ArtboardImportedPage, ArtboardImportSource } from './files';

export const ARTBOARD_SOURCE_CONCURRENCY = 5;

export interface ArtboardSourceResolver {
  imageBytes: (fileRef: string) => Promise<ArtboardImageBytes | undefined>;
  importPage: (source: ArtboardImportSource) => Promise<ArtboardImportedPage | undefined>;
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
    imageBytes: async (fileRef) => {
      let fileId: string | undefined = fileRef;
      if (MEDIA_REF_PATTERN.test(fileRef)) {
        const pending = (mediaFileIds ??= listMediaFileIds());
        fileId = (await pending).get(fileRef);
      }
      if (!fileId) return;
      const file = await files.findById(fileId);
      if (!file?.fileType.startsWith('image/')) return;
      const bytes = await new FileService(db, userId, workspaceId).getFileByteArray(file.url);
      return { bytes, contentType: file.fileType };
    },
    // The same standalone bundle a published Canvas site serves: runtime injected, assets beside it.
    importPage: async ({ canvasId, version }) => {
      const works = new WorkModel(db, userId, workspaceId);
      const current = await works.findCanvas(canvasId);
      if (!current) return;
      const versionRow =
        version === undefined || version === current.version.version
          ? current.version
          : await works.findCanvasVersion(current.work.id, version);
      const canvas = versionRow?.metadata?.canvas;
      if (!canvas) return;
      const runtimeUrl = await getCanvasPublishRuntimeUrl(canvas.runtimeMajor);
      if (!runtimeUrl) return;
      const storage = createCanvasStorageService(db, current.work.userId, workspaceId);
      const bundle = await buildCanvasPublishBundle(
        storage,
        await storage.readManifest(canvas.manifestKey),
        runtimeUrl,
      );
      const encoder = new TextEncoder();
      return {
        assets: bundle.files.map((file) => ({
          bytes:
            file.encoding === 'base64'
              ? new Uint8Array(Buffer.from(file.content, 'base64'))
              : encoder.encode(file.content),
          path: file.path.replace(/^\/+/, ''),
        })),
        entry: encoder.encode(bundle.html),
      };
    },
  };
};
