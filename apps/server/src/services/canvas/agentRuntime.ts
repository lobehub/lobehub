import { buildCanvasOpenUrl, CanvasApiName, CanvasIdentifier } from '@lobechat/builtin-tool-canvas';
import { CanvasExecutionRuntime } from '@lobechat/builtin-tool-canvas/executionRuntime';
import { createMediaFileItemsFromMessage } from '@lobechat/builtin-tool-lobe-agent';

import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { WorkModel } from '@/database/models/work';
import { WorkspaceModel } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { FileService } from '@/server/services/file';

import { type CanvasFileRefResolver, createCanvasFileRefResolver } from './fileRefs';
import { createCanvasStorageService } from './index';
import { CanvasToolServiceImpl } from './toolService';

export interface CanvasAgentRuntimeScope {
  agentId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  userId: string;
  workspaceId?: string;
}

export const createCanvasFileRefResolverFor = (
  db: LobeChatDatabase,
  scope: CanvasAgentRuntimeScope,
): CanvasFileRefResolver => {
  const { userId, workspaceId } = scope;

  return createCanvasFileRefResolver({
    findFile: async (id) => {
      const file = await new FileModel(db, userId, workspaceId).findById(id);
      return file
        ? { fileType: file.fileType, id: file.id, name: file.name, size: file.size, url: file.url }
        : undefined;
    },
    listMediaFileIds: async () => {
      if (!scope.topicId) return new Map();
      const messages = await new MessageModel(db, userId, workspaceId).query({
        agentId: scope.agentId ?? undefined,
        skipWorks: true,
        threadId: scope.threadId ?? undefined,
        topicId: scope.topicId,
      });
      return new Map(
        messages
          .flatMap((message) => createMediaFileItemsFromMessage(message))
          .map((item) => [item.ref, item.id]),
      );
    },
    readBytes: (key) => new FileService(db, userId, workspaceId).getFileByteArray(key),
  });
};

const getAppUrl = (): string | undefined => {
  try {
    return appEnv.APP_URL;
  } catch {
    return process.env.APP_URL;
  }
};

/**
 * Resolve the conversation link for a Canvas. The route is built from the topic
 * row because a sub-agent's scope names a different agent than the conversation.
 * Group conversations have no working sidebar to open, and a workspace
 * conversation only resolves under its slug, so both cases return no link.
 */
export const createCanvasOpenUrlResolver =
  (db: LobeChatDatabase, scope: CanvasAgentRuntimeScope) =>
  async (canvasId: string): Promise<string | undefined> => {
    const { topicId, userId, workspaceId } = scope;
    if (!topicId) return undefined;

    const topic = await new TopicModel(db, userId, workspaceId).findById(topicId);
    if (!topic || topic.groupId) return undefined;

    const workspaceSlug = workspaceId
      ? (await new WorkspaceModel(db, userId).findById(workspaceId))?.slug
      : undefined;
    if (workspaceId && !workspaceSlug) return undefined;

    return buildCanvasOpenUrl(getAppUrl(), {
      agentId: topic.agentId ?? scope.agentId,
      canvasId,
      topicId,
      workspaceSlug,
    });
  };

export const createCanvasAgentRuntime = (db: LobeChatDatabase, scope: CanvasAgentRuntimeScope) => {
  const { userId, workspaceId } = scope;

  return new CanvasExecutionRuntime(
    new CanvasToolServiceImpl({
      agentId: scope.agentId,
      resolveFileRefs: createCanvasFileRefResolverFor(db, scope),
      resolveOpenUrl: createCanvasOpenUrlResolver(db, scope),
      findGuideState: () =>
        new MessageModel(db, userId, workspaceId).findLatestPluginStateInTopic({
          apiName: CanvasApiName.readCanvasGuide,
          identifier: CanvasIdentifier,
          threadId: scope.threadId,
          topicId: scope.topicId!,
        }),
      storage: createCanvasStorageService(db, userId, workspaceId),
      storageFor: (ownerId) => createCanvasStorageService(db, ownerId, workspaceId),
      topicId: scope.topicId,
      workModel: new WorkModel(db, userId, workspaceId),
    }),
  );
};
