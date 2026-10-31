// Fixture: row types come from the types package; the schema module only provides tables.
import type {
  UserMemoryActivityWithoutVectors,
  UserMemoryContextInsert,
  UserPersonaDocument,
  UserPersonaDocumentHistory,
} from '@lobechat/types';

import { userMemoriesActivities } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export interface UserPersonaAgentResult {
  diff?: UserPersonaDocumentHistory;
  document: UserPersonaDocument;
}

export const listActivities = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<UserMemoryActivityWithoutVectors[]> =>
  db
    .select()
    .from(userMemoriesActivities)
    .where((t) => t.userId === userId) as unknown as Promise<UserMemoryActivityWithoutVectors[]>;

export const contextValues = (userId: string): UserMemoryContextInsert => ({ userId });
