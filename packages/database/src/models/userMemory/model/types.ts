import type {
  IdentityTypeEnum,
  LayersEnum,
  MergeStrategyEnum,
  Optional,
  RelationshipEnum,
  TypesEnum,
  UserMemoryActivity,
  UserMemoryActivityWithoutVectors,
  UserMemoryContext,
  UserMemoryContextObjectType,
  UserMemoryContextSubjectType,
  UserMemoryContextWithoutVectors,
  UserMemoryExperience,
  UserMemoryExperienceWithoutVectors,
  UserMemoryIdentity,
  UserMemoryItemSimple,
  UserMemoryPreference,
  UserMemoryPreferenceWithoutVectors,
} from '@lobechat/types';

export interface BaseCreateUserMemoryParams {
  capturedAt?: Date;
  details: string;
  detailsEmbedding?: number[];
  memoryCategory?: string | null;
  memoryLayer: LayersEnum;
  memoryType: TypesEnum;
  summary: string;
  summaryEmbedding?: number[];
  title: string;
  titleEmbedding?: number[];
}

export interface CreateUserMemoryContextParams extends BaseCreateUserMemoryParams {
  context: Optional<
    Omit<
      UserMemoryContext,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'accessedAt' | 'userMemoryIds' | 'userMemoryId'
    >,
    | 'capturedAt'
    | 'firstSeenAt'
    | 'lastEvidenceAt'
    | 'nextSteps'
    | 'now'
    | 'openQuestions'
    | 'synthesizedAt'
  >;
}

export interface CreateUserMemoryActivityParams extends BaseCreateUserMemoryParams {
  activity: Optional<
    Omit<
      UserMemoryActivity,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'accessedAt' | 'userMemoryId'
    >,
    'capturedAt' | 'dossierId' | 'injectable'
  >;
}

export interface CreateUserMemoryExperienceParams extends BaseCreateUserMemoryParams {
  experience: Optional<
    Omit<
      UserMemoryExperience,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'accessedAt' | 'userMemoryId'
    >,
    'capturedAt'
  >;
}

export interface CreateUserMemoryIdentityParams extends BaseCreateUserMemoryParams {
  identity: Optional<
    Omit<
      UserMemoryIdentity,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'accessedAt' | 'userMemoryId'
    >,
    'capturedAt' | 'entityId'
  >;
}

export interface CreateUserMemoryPreferenceParams extends BaseCreateUserMemoryParams {
  preference: Optional<
    Omit<
      UserMemoryPreference,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'accessedAt' | 'userMemoryId'
    >,
    | 'appliesToEntityId'
    | 'capturedAt'
    | 'evidenceCount'
    | 'evidenceSource'
    | 'holderEntityId'
    | 'lastEvidenceAt'
    | 'scope'
  >;
}

export type CreateUserMemoryParams =
  | CreateUserMemoryActivityParams
  | CreateUserMemoryContextParams
  | CreateUserMemoryExperienceParams
  | CreateUserMemoryIdentityParams
  | CreateUserMemoryPreferenceParams;

export interface SearchUserMemoryParams {
  embedding?: number[];
  limit?: number;
  limits?: Partial<Record<'activities' | 'contexts' | 'experiences' | 'preferences', number>>;
  memoryCategory?: string;
  memoryType?: string;
  query?: string;
}

export interface SearchUserMemoryWithEmbeddingParams {
  embedding?: number[];
  limits?: Partial<Record<'activities' | 'contexts' | 'experiences' | 'preferences', number>>;
  memoryCategory?: string;
  memoryType?: string;
}

export interface UserMemorySearchAggregatedResult {
  activities: UserMemoryActivityWithoutVectors[];
  contexts: UserMemoryContextWithoutVectors[];
  experiences: UserMemoryExperienceWithoutVectors[];
  preferences: UserMemoryPreferenceWithoutVectors[];
}

export interface UpdateUserMemoryVectorsParams {
  detailsVector1024?: number[] | null;
  summaryVector1024?: number[] | null;
}

export interface UpdateContextVectorsParams {
  descriptionVector?: number[] | null;
  titleVector?: number[] | null;
}

export interface UpdatePreferenceVectorsParams {
  conclusionDirectivesVector?: number[] | null;
}

export interface UpdateIdentityVectorsParams {
  descriptionVector?: number[] | null;
}

export interface UpdateExperienceVectorsParams {
  actionVector?: number[] | null;
  keyLearningVector?: number[] | null;
  situationVector?: number[] | null;
}

export interface IdentityEntryPayload {
  capturedAt?: Date;
  description?: string | null;
  descriptionVector?: number[] | null;
  episodicDate?: string | Date | null;
  metadata?: Record<string, unknown> | null;
  relationship?: RelationshipEnum | string | null;
  role?: string | null;
  tags?: string[] | null;
  type?: IdentityTypeEnum | string | null;
}

export interface IdentityEntryBasePayload {
  capturedAt?: Date;
  details?: string | null;
  detailsVector1024?: number[] | null;
  lastAccessedAt?: string | Date | null;
  memoryCategory?: string | null;
  memoryLayer?: string | null;
  memoryType?: string | null;
  metadata?: Record<string, unknown> | null;
  status?: string | null;
  summary?: string | null;
  summaryVector1024?: number[] | null;
  tags?: string[] | null;
  title?: string | null;
}

export interface AddIdentityEntryParams {
  base: IdentityEntryBasePayload;
  identity: IdentityEntryPayload;
}

export interface AddIdentityEntryResult {
  identityId: string;
  userMemoryId: string;
}

export interface UpdateIdentityEntryParams {
  base?: IdentityEntryBasePayload;
  identity?: IdentityEntryPayload;
  identityId: string;
  mergeStrategy?: MergeStrategyEnum;
  /**
   * With `replace`, only overwrite the identity fields present in `identity` and keep the
   * rest. Tool calls send just the fields they change; the extractor sends a full identity
   * and relies on omitted fields being cleared, so it leaves this off.
   */
  preserveOmittedFields?: boolean;
}

export interface ContextEntryPayload {
  associatedObjects?:
    { extra?: Record<string, unknown>; name?: string; type?: UserMemoryContextObjectType }[] | null;
  associatedSubjects?:
    | { extra?: Record<string, unknown>; name?: string; type?: UserMemoryContextSubjectType }[]
    | null;
  currentStatus?: string | null;
  description?: string | null;
  descriptionVector?: number[] | null;
  metadata?: Record<string, unknown> | null;
  scoreImpact?: number | null;
  scoreUrgency?: number | null;
  tags?: string[] | null;
  title?: string | null;
  type?: string | null;
}

export interface UpdateContextEntryParams {
  context?: ContextEntryPayload;
  contextId: string;
}

export interface ExperienceEntryPayload {
  action?: string | null;
  actionVector?: number[] | null;
  keyLearning?: string | null;
  keyLearningVector?: number[] | null;
  metadata?: Record<string, unknown> | null;
  possibleOutcome?: string | null;
  reasoning?: string | null;
  scoreConfidence?: number | null;
  situation?: string | null;
  situationVector?: number[] | null;
  tags?: string[] | null;
  type?: string | null;
}

export interface UpdateExperienceEntryParams {
  experience?: ExperienceEntryPayload;
  experienceId: string;
}

export interface PreferenceEntryPayload {
  conclusionDirectives?: string | null;
  conclusionDirectivesVector?: number[] | null;
  metadata?: Record<string, unknown> | null;
  scorePriority?: number | null;
  suggestions?: string | null;
  tags?: string[] | null;
  type?: string | null;
}

export interface UpdatePreferenceEntryParams {
  preference?: PreferenceEntryPayload;
  preferenceId: string;
}

export interface QueryTagsParams {
  layers?: LayersEnum[];
  page?: number;
  size?: number;
}

export interface QueryTagsResult {
  count: number;
  tag: string;
}

export interface QueryIdentityRolesParams {
  page?: number;
  size?: number;
}

export interface QueryIdentityRolesResult {
  roles: Array<{ count: number; role: string }>;
  tags: Array<{ count: number; tag: string }>;
}

export type QueryUserMemoriesSort =
  | 'capturedAt' // all layers
  | 'scoreConfidence' // user_memories_experiences
  | 'scoreImpact' // user_memories_contexts
  | 'scorePriority' // user_memories_preferences
  | 'scoreUrgency' // user_memories_contexts
  | 'startsAt'; // user_memories_activities

export interface QueryUserMemoriesParams {
  categories?: string[];
  layer?: LayersEnum;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: QueryUserMemoriesSort;
  status?: string[];
  tags?: string[];
  types?: string[];
}

export interface GetMemoriesResult {
  items: UserMemoryItemSimple[];
  page: number;
  pageSize: number;
  total: number;
}

export interface GetMemoryDetailParams {
  id: string;
  layer: LayersEnum;
}
