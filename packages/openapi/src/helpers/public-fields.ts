import { parsePluginEntry } from '@lobechat/types';

import type {
  AgentEvalDatasetItem,
  AgentEvalRunItem,
  AgentEvalRunTopicItem,
  AgentEvalTestCaseItem,
  AgentItem,
  AiModelSelectItem,
  AiProviderSelectItem,
  FileItem,
  KnowledgeBaseItem,
  MessageItem,
  PermissionItem,
  RoleItem,
  SessionGroupItem,
  SessionItem,
  TopicItem,
  UserItem,
} from '@/database/schemas';

const pickPublicFields = <T extends object, K extends readonly (keyof T)[]>(
  value: T,
  fields: K,
): Pick<T, K[number]> => {
  const result = {} as Pick<T, K[number]>;

  for (const field of fields) {
    result[field] = value[field];
  }

  return result;
};

export const PUBLIC_AGENT_FIELDS = [
  'agencyConfig',
  'avatar',
  'chatConfig',
  'createdAt',
  'description',
  'id',
  'model',
  'params',
  'provider',
  'slug',
  'systemRole',
  'title',
  'updatedAt',
] as const satisfies readonly (keyof AgentItem)[];

export const PUBLIC_USER_FIELDS = [
  'avatar',
  'createdAt',
  'email',
  'firstName',
  'fullName',
  'id',
  'isOnboarded',
  'lastName',
  'phone',
  'updatedAt',
  'username',
] as const satisfies readonly (keyof UserItem)[];

export const PUBLIC_PROVIDER_FIELDS = [
  'checkModel',
  'config',
  'createdAt',
  'description',
  'enabled',
  'fetchOnClient',
  'id',
  'logo',
  'name',
  'settings',
  'sort',
  'source',
  'updatedAt',
] as const satisfies readonly (keyof AiProviderSelectItem)[];

export const PUBLIC_MODEL_FIELDS = [
  'abilities',
  'config',
  'contextWindowTokens',
  'createdAt',
  'description',
  'displayName',
  'enabled',
  'id',
  'organization',
  'parameters',
  'pricing',
  'providerId',
  'releasedAt',
  'settings',
  'sort',
  'source',
  'type',
  'updatedAt',
] as const satisfies readonly (keyof AiModelSelectItem)[];

export const PUBLIC_FILE_FIELDS = [
  'createdAt',
  'fileType',
  'id',
  'metadata',
  'name',
  'parentId',
  'size',
  'source',
  'updatedAt',
  'url',
  'visibility',
] as const satisfies readonly (keyof FileItem)[];

export const PUBLIC_KNOWLEDGE_BASE_FIELDS = [
  'avatar',
  'createdAt',
  'description',
  'id',
  'isPublic',
  'name',
  'settings',
  'type',
  'updatedAt',
  'visibility',
] as const satisfies readonly (keyof KnowledgeBaseItem)[];

export const PUBLIC_AGENT_GROUP_FIELDS = [
  'createdAt',
  'id',
  'name',
  'sort',
  'updatedAt',
] as const satisfies readonly (keyof SessionGroupItem)[];

export const PUBLIC_SESSION_FIELDS = [
  'avatar',
  'backgroundColor',
  'createdAt',
  'description',
  'groupId',
  'id',
  'pinned',
  'slug',
  'title',
  'type',
  'updatedAt',
] as const satisfies readonly (keyof SessionItem)[];

export const PUBLIC_TOPIC_FIELDS = [
  'agentId',
  'completedAt',
  'content',
  'cost',
  'createdAt',
  'description',
  'favorite',
  'groupId',
  'historySummary',
  'id',
  'metadata',
  'mode',
  'model',
  'provider',
  'sessionId',
  'status',
  'title',
  'totalCost',
  'totalInputTokens',
  'totalOutputTokens',
  'totalTokens',
  'trigger',
  'updatedAt',
  'usage',
] as const satisfies readonly (keyof TopicItem)[];

export const PUBLIC_MESSAGE_FIELDS = [
  'agentId',
  'content',
  'createdAt',
  'error',
  'favorite',
  'groupId',
  'id',
  'messageGroupId',
  'metadata',
  'model',
  'observationId',
  'parentId',
  'provider',
  'quotaId',
  'reasoning',
  'role',
  'search',
  'sessionId',
  'summary',
  'targetId',
  'threadId',
  'tools',
  'topicId',
  'traceId',
  'updatedAt',
  'usage',
] as const satisfies readonly (keyof MessageItem)[];

export const PUBLIC_ROLE_FIELDS = [
  'createdAt',
  'description',
  'displayName',
  'id',
  'isActive',
  'isSystem',
  'name',
  'updatedAt',
] as const satisfies readonly (keyof RoleItem)[];

export const PUBLIC_PERMISSION_FIELDS = [
  'category',
  'code',
  'createdAt',
  'description',
  'id',
  'isActive',
  'name',
  'updatedAt',
] as const satisfies readonly (keyof PermissionItem)[];

export const PUBLIC_EVAL_RUN_FIELDS = [
  'config',
  'createdAt',
  'datasetId',
  'experimentId',
  'id',
  'metrics',
  'name',
  'parentRunId',
  'startedAt',
  'status',
  'targetAgentId',
  'updatedAt',
] as const satisfies readonly (keyof AgentEvalRunItem)[];

export const PUBLIC_EVAL_DATASET_FIELDS = [
  'benchmarkId',
  'createdAt',
  'description',
  'evalConfig',
  'evalMode',
  'id',
  'identifier',
  'metadata',
  'name',
  'sourceExperimentId',
  'updatedAt',
] as const satisfies readonly (keyof AgentEvalDatasetItem)[];

export const PUBLIC_EVAL_TEST_CASE_FIELDS = [
  'content',
  'createdAt',
  'datasetId',
  'evalConfig',
  'evalMode',
  'id',
  'metadata',
  'sortOrder',
  'updatedAt',
] as const satisfies readonly (keyof AgentEvalTestCaseItem)[];

export const PUBLIC_EVAL_RUN_TOPIC_FIELDS = [
  'createdAt',
  'evalResult',
  'passed',
  'runId',
  'score',
  'status',
  'testCaseId',
  'topicId',
] as const satisfies readonly (keyof AgentEvalRunTopicItem)[];

export type PublicAgent = Pick<AgentItem, (typeof PUBLIC_AGENT_FIELDS)[number]> & {
  plugins: ReturnType<typeof parsePluginEntry>[];
};
export type PublicUser = Pick<UserItem, (typeof PUBLIC_USER_FIELDS)[number]>;
export type PublicProvider = Pick<AiProviderSelectItem, (typeof PUBLIC_PROVIDER_FIELDS)[number]>;
export type PublicModel = Pick<AiModelSelectItem, (typeof PUBLIC_MODEL_FIELDS)[number]>;
export type PublicFile = Pick<FileItem, (typeof PUBLIC_FILE_FIELDS)[number]>;
export type PublicKnowledgeBase = Pick<
  KnowledgeBaseItem,
  (typeof PUBLIC_KNOWLEDGE_BASE_FIELDS)[number]
>;
export type PublicAgentGroup = Pick<SessionGroupItem, (typeof PUBLIC_AGENT_GROUP_FIELDS)[number]>;
export type PublicSession = Pick<SessionItem, (typeof PUBLIC_SESSION_FIELDS)[number]>;
export type PublicTopic = Pick<TopicItem, (typeof PUBLIC_TOPIC_FIELDS)[number]>;
export type PublicMessage = Pick<MessageItem, (typeof PUBLIC_MESSAGE_FIELDS)[number]>;
export type PublicEvalRun = Pick<AgentEvalRunItem, (typeof PUBLIC_EVAL_RUN_FIELDS)[number]>;
export type PublicEvalDataset = Pick<
  AgentEvalDatasetItem,
  (typeof PUBLIC_EVAL_DATASET_FIELDS)[number]
>;
export type PublicEvalTestCase = Pick<
  AgentEvalTestCaseItem,
  (typeof PUBLIC_EVAL_TEST_CASE_FIELDS)[number]
>;
export type PublicEvalRunTopic = Pick<
  AgentEvalRunTopicItem,
  (typeof PUBLIC_EVAL_RUN_TOPIC_FIELDS)[number]
>;
export type PublicRole = Pick<RoleItem, (typeof PUBLIC_ROLE_FIELDS)[number]>;
export type PublicPermission = Pick<PermissionItem, (typeof PUBLIC_PERMISSION_FIELDS)[number]>;

export const projectPublicAgent = (value: AgentItem): PublicAgent => ({
  ...pickPublicFields(value, PUBLIC_AGENT_FIELDS),
  plugins: (value.plugins ?? []).map(parsePluginEntry),
});

export const projectPublicUser = (value: UserItem): PublicUser =>
  pickPublicFields(value, PUBLIC_USER_FIELDS);

export const projectPublicProvider = (value: AiProviderSelectItem): PublicProvider =>
  pickPublicFields(value, PUBLIC_PROVIDER_FIELDS);

export const projectPublicModel = (value: AiModelSelectItem): PublicModel =>
  pickPublicFields(value, PUBLIC_MODEL_FIELDS);

export const projectPublicFile = (value: FileItem): PublicFile =>
  pickPublicFields(value, PUBLIC_FILE_FIELDS);

export const projectPublicKnowledgeBase = (value: KnowledgeBaseItem): PublicKnowledgeBase =>
  pickPublicFields(value, PUBLIC_KNOWLEDGE_BASE_FIELDS);

export const projectPublicAgentGroup = (value: SessionGroupItem): PublicAgentGroup =>
  pickPublicFields(value, PUBLIC_AGENT_GROUP_FIELDS);

export const projectPublicSession = (value: SessionItem): PublicSession =>
  pickPublicFields(value, PUBLIC_SESSION_FIELDS);

export const projectPublicTopic = (value: TopicItem): PublicTopic =>
  pickPublicFields(value, PUBLIC_TOPIC_FIELDS);

export const projectPublicMessage = (value: MessageItem): PublicMessage =>
  pickPublicFields(value, PUBLIC_MESSAGE_FIELDS);

export const projectPublicEvalRun = (value: AgentEvalRunItem): PublicEvalRun =>
  pickPublicFields(value, PUBLIC_EVAL_RUN_FIELDS);

export const projectPublicEvalDataset = (value: AgentEvalDatasetItem): PublicEvalDataset =>
  pickPublicFields(value, PUBLIC_EVAL_DATASET_FIELDS);

export const projectPublicEvalTestCase = (value: AgentEvalTestCaseItem): PublicEvalTestCase =>
  pickPublicFields(value, PUBLIC_EVAL_TEST_CASE_FIELDS);

// Accepts any row that carries the public columns (e.g. joined run-topic rows
// without userId/workspaceId), while still projecting only the public fields.
export const projectPublicEvalRunTopic = (value: PublicEvalRunTopic): PublicEvalRunTopic =>
  pickPublicFields(value, PUBLIC_EVAL_RUN_TOPIC_FIELDS);

export const projectPublicRole = (value: RoleItem): PublicRole =>
  pickPublicFields(value, PUBLIC_ROLE_FIELDS);

export const projectPublicPermission = (value: PermissionItem): PublicPermission =>
  pickPublicFields(value, PUBLIC_PERMISSION_FIELDS);
