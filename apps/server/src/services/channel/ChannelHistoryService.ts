import type { ChannelReadMessageParams, ChannelReadMessagesParams } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import pMap from 'p-map';

import { ChannelHistoryRepository } from '@/database/repositories/channel';
import { files } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

import { assertChannelEnabled } from './featureGate';

/** Both the builtin tool and operation-authenticated CLI use this exact read boundary. */
export class ChannelHistoryService {
  private readonly repository: ChannelHistoryRepository;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly operationId: string,
    private readonly workspaceId?: string,
  ) {
    this.repository = new ChannelHistoryRepository(db, userId, workspaceId);
  }

  readMessages = async (params: ChannelReadMessagesParams) => {
    await assertChannelEnabled(this.userId);
    return this.repository.readMessages(this.operationId, params);
  };

  readMessage = async (params: ChannelReadMessageParams) => {
    await assertChannelEnabled(this.userId);
    const result = await this.repository.readMessage(this.operationId, params);
    const ids = result.message.fileIds ?? [];
    const shared = ids.length
      ? await this.db
          .select({
            id: files.id,
            name: files.name,
            fileType: files.fileType,
            size: files.size,
            url: files.url,
          })
          .from(files)
          .where(inArray(files.id, ids))
      : [];
    const fileService = new FileService(this.db, this.userId, this.workspaceId);
    return {
      ...result,
      attachments: await pMap(
        shared,
        async (file) => ({ ...file, url: await fileService.getFullFileUrl(file.url, 300) }),
        { concurrency: 10 },
      ),
    };
  };
}
