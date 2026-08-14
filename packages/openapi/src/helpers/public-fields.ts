import type {
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

export type PublicAgent = Pick<AgentItem, (typeof PUBLIC_AGENT_FIELDS)[number]>;
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
export type PublicRole = Pick<RoleItem, (typeof PUBLIC_ROLE_FIELDS)[number]>;
export type PublicPermission = Pick<PermissionItem, (typeof PUBLIC_PERMISSION_FIELDS)[number]>;

export const projectPublicAgent = (value: AgentItem): PublicAgent =>
  pickPublicFields(value, PUBLIC_AGENT_FIELDS);

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

export const projectPublicRole = (value: RoleItem): PublicRole =>
  pickPublicFields(value, PUBLIC_ROLE_FIELDS);

export const projectPublicPermission = (value: PermissionItem): PublicPermission =>
  pickPublicFields(value, PUBLIC_PERMISSION_FIELDS);
