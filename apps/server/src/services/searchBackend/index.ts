import type { LobeChatDatabase } from '@lobechat/database';

import type { SearchRepoOptions } from '@/database/repositories/search';
import { SearchRepo } from '@/database/repositories/search';

export interface CreateSearchRepoInput {
  callerAgentVisibility?: 'private' | 'public' | null;
  db: LobeChatDatabase;
  options?: SearchRepoOptions;
  userId: string;
  workspaceId?: string;
}

/** OSS uses pg_search unless a deployment overrides this server-side factory. */
export const createSearchRepo = async ({
  callerAgentVisibility,
  db,
  options,
  userId,
  workspaceId,
}: CreateSearchRepoInput) =>
  new SearchRepo(db, userId, workspaceId, callerAgentVisibility, options);
