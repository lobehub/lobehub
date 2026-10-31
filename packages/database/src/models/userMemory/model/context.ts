import type {
  MemorySourceType,
  UserMemoryActivityWithoutVectors,
  UserMemoryContextWithoutVectors,
  UserMemoryExperienceWithoutVectors,
  UserMemoryInsert,
  UserMemoryPreferenceWithoutVectors,
  UserMemoryWithoutVectors,
} from '@lobechat/types';

import type { FtsSearchCandidateSource } from '../../../repositories/ftsSearch';
import type { LobeChatDatabase } from '../../../type';
import type { TopicModel } from '../../topic';
import type { buildUserMemoryWhere } from '../where';
import type { BaseCreateUserMemoryParams } from './types';

export interface SearchLayerParams {
  embedding?: number[];
  limit?: number;
  type?: string;
}

/**
 * What the extracted `UserMemoryModel` modules read from the model. Collaborators are getters and
 * methods dispatch through the instance, so spies and field replacements on the model still apply.
 */
export interface UserMemoryModelContext {
  buildBaseMemoryInsertValues: (
    params: BaseCreateUserMemoryParams,
    options?: {
      metadata?: Record<string, unknown> | null;
      status?: string | null;
      tags?: string[] | null;
    },
  ) => UserMemoryInsert;
  readonly db: LobeChatDatabase;
  extractSourceMetadata: (metadata?: Record<string, unknown> | null) => {
    sourceId?: string;
    sourceType?: MemorySourceType;
  };
  findUserMemoryRawById: (memoryId: string) => Promise<UserMemoryWithoutVectors | undefined>;
  readonly ftsSearchCandidateSource?: FtsSearchCandidateSource;
  memoryWhere: (
    table: Parameters<typeof buildUserMemoryWhere>[2],
  ) => ReturnType<typeof buildUserMemoryWhere>;
  searchActivities: (params: SearchLayerParams) => Promise<UserMemoryActivityWithoutVectors[]>;
  searchContexts: (params: SearchLayerParams) => Promise<UserMemoryContextWithoutVectors[]>;
  searchExperiences: (params: SearchLayerParams) => Promise<UserMemoryExperienceWithoutVectors[]>;
  searchPreferences: (params: SearchLayerParams) => Promise<UserMemoryPreferenceWithoutVectors[]>;
  readonly topicModel: TopicModel;
  updateAccessMetrics: (
    memoryIds: string[],
    options?: { contextIds?: string[]; timestamp?: Date },
  ) => Promise<void>;
  readonly userId: string;
}
