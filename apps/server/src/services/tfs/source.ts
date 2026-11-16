import { parseTfsRepository } from '@lobechat/utils/tfs';
import { TRPCError } from '@trpc/server';

import type { LobeChatDatabase } from '@/database/type';

import { tfsCollection, TfsConnectionService } from './connection';

/** Saving shared metadata never borrows the owner's credential for another member. */
export const validateTfsSources = async (
  db: LobeChatDatabase,
  userId: string,
  sources?: { kind?: string; url?: string }[],
) => {
  for (const source of sources ?? []) {
    if (source.kind !== 'git' || !source.url || !parseTfsRepository(source.url)) continue;
    const collection = tfsCollection();
    if (!collection || !parseTfsRepository(source.url, collection)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'TFS_INVALID_REPOSITORY_URL' });
    }
    await (await new TfsConnectionService(db, userId).client()).resolveRepository(source.url);
  }
};
