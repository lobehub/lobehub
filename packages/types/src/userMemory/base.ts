import type { UserMemory } from './rows';

export type UserMemoryWithoutVectors = Omit<UserMemory, 'summaryVector1024' | 'detailsVector1024'>;

/** The fields the list query selects; detail views use the full row. */
export type UserMemoryListItem = Pick<
  UserMemory,
  | 'accessedAt'
  | 'accessedCount'
  | 'createdAt'
  | 'id'
  | 'lastAccessedAt'
  | 'memoryCategory'
  | 'memoryLayer'
  | 'memoryType'
  | 'metadata'
  | 'status'
  | 'tags'
  | 'title'
  | 'updatedAt'
  | 'userId'
>;
