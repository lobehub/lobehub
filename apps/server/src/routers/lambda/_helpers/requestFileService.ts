import type { LobeChatDatabase } from '@lobechat/database';

import { FileService } from '@/server/services/file';

/**
 * The request user's file storage, where an MCP tool result's image / audio
 * blocks are stored. `undefined` without file storage configured (its S3
 * client throws on an incomplete env): the call still runs, its media inline.
 */
export const resolveRequestFileService = (ctx: {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}): FileService | undefined => {
  try {
    return new FileService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
  } catch {
    return undefined;
  }
};
