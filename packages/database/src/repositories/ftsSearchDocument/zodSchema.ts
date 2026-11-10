import type { FtsSearchDocumentEntity } from '@lobechat/types';
import { z } from 'zod';

export type { FtsSearchDocumentEntity } from '@lobechat/types';
export { FTS_SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';

export const FTS_SEARCH_MEMORY_DOCUMENT_ENTITIES = [
  'memoryActivities',
  'memoryContexts',
  'memoryExperiences',
  'memoryIdentities',
  'memoryPreferences',
  'personaDocuments',
  'userMemories',
] as const satisfies readonly FtsSearchDocumentEntity[];

export type FtsSearchMemoryDocumentEntity = (typeof FTS_SEARCH_MEMORY_DOCUMENT_ENTITIES)[number];

const dateTime = z.string().datetime();
const nullableDateTime = dateTime.nullable();
const nullableString = z.string().nullable();
const stringArray = z.array(z.string());
const visibility = z.enum(['private', 'public']);

const timestampShape = {
  created_at: dateTime,
  updated_at: dateTime,
};

const projectionMetadataShape = {
  fts_search_sync_deleted: z.boolean().optional(),
};

const ownershipShape = {
  user_id: z.string(),
  visibility,
  workspace_id: nullableString,
};

export const FTS_SEARCH_DOCUMENT_SCHEMAS = {
  agents: z
    .object({
      ...ownershipShape,
      ...projectionMetadataShape,
      ...timestampShape,
      description: nullableString,
      id: z.string(),
      slug: nullableString,
      system_role: nullableString,
      tags: stringArray,
      title: nullableString,
      virtual: z.boolean().nullable(),
    })
    .strict(),
  chatGroups: z
    .object({
      ...ownershipShape,
      ...projectionMetadataShape,
      ...timestampShape,
      content: nullableString,
      description: nullableString,
      group_id: nullableString,
      id: z.string(),
      title: nullableString,
    })
    .strict(),
  documents: z
    .object({
      ...ownershipShape,
      ...projectionMetadataShape,
      ...timestampShape,
      content: nullableString,
      description: nullableString,
      file_id: nullableString,
      file_type: z.string(),
      id: z.string(),
      knowledge_base_id: nullableString,
      knowledge_base_ids: stringArray,
      parent_id: nullableString,
      slug: nullableString,
      source_type: z.string(),
      title: nullableString,
      total_char_count: z.number().int(),
    })
    .strict(),
  files: z
    .object({
      ...ownershipShape,
      ...projectionMetadataShape,
      ...timestampShape,
      file_type: z.string(),
      id: z.string(),
      knowledge_base_ids: stringArray,
      name: z.string(),
      size: z.number().int(),
      source: nullableString,
    })
    .strict(),
  knowledgeBases: z
    .object({
      ...ownershipShape,
      ...projectionMetadataShape,
      ...timestampShape,
      description: nullableString,
      id: z.string(),
      is_public: z.boolean().nullable(),
      name: z.string(),
      type: nullableString,
    })
    .strict(),
  memoryActivities: z
    .object({
      ...projectionMetadataShape,
      ...timestampShape,
      captured_at: dateTime,
      ends_at: nullableDateTime,
      feedback: nullableString,
      id: z.string(),
      narrative: nullableString,
      notes: nullableString,
      parent_details: nullableString,
      parent_memory_categories: stringArray,
      parent_summary: nullableString,
      parent_tags: stringArray,
      parent_title: nullableString,
      starts_at: nullableDateTime,
      status: z.string(),
      tags: stringArray,
      type: z.string(),
      user_id: nullableString,
      user_memory_id: nullableString,
    })
    .strict(),
  memoryContexts: z
    .object({
      ...projectionMetadataShape,
      ...timestampShape,
      captured_at: dateTime,
      current_status: nullableString,
      description: nullableString,
      id: z.string(),
      parent_memory_categories: stringArray,
      parent_tags: stringArray,
      parent_text: stringArray,
      tags: stringArray,
      title: nullableString,
      type: nullableString,
      user_id: nullableString,
      user_memory_ids: stringArray,
    })
    .strict(),
  memoryExperiences: z
    .object({
      ...projectionMetadataShape,
      ...timestampShape,
      action: nullableString,
      captured_at: dateTime,
      id: z.string(),
      key_learning: nullableString,
      parent_details: nullableString,
      parent_memory_categories: stringArray,
      parent_summary: nullableString,
      parent_tags: stringArray,
      parent_title: nullableString,
      possible_outcome: nullableString,
      reasoning: nullableString,
      situation: nullableString,
      tags: stringArray,
      type: nullableString,
      user_id: nullableString,
      user_memory_id: nullableString,
    })
    .strict(),
  memoryIdentities: z
    .object({
      ...projectionMetadataShape,
      ...timestampShape,
      captured_at: dateTime,
      description: nullableString,
      episodic_date: nullableDateTime,
      id: z.string(),
      parent_details: nullableString,
      parent_memory_categories: stringArray,
      parent_summary: nullableString,
      parent_tags: stringArray,
      parent_title: nullableString,
      relationship: nullableString,
      role: nullableString,
      tags: stringArray,
      type: nullableString,
      user_id: nullableString,
      user_memory_id: nullableString,
    })
    .strict(),
  memoryPreferences: z
    .object({
      ...projectionMetadataShape,
      ...timestampShape,
      captured_at: dateTime,
      conclusion_directives: nullableString,
      id: z.string(),
      parent_details: nullableString,
      parent_memory_categories: stringArray,
      parent_summary: nullableString,
      parent_tags: stringArray,
      parent_title: nullableString,
      suggestions: nullableString,
      tags: stringArray,
      type: nullableString,
      user_id: nullableString,
      user_memory_id: nullableString,
    })
    .strict(),
  messages: z
    .object({
      ...projectionMetadataShape,
      ...timestampShape,
      agent_id: nullableString,
      content: nullableString,
      group_id: nullableString,
      id: z.string(),
      role: z.string(),
      session_id: nullableString,
      summary: nullableString,
      thread_id: nullableString,
      topic_id: nullableString,
      user_id: z.string(),
      workspace_id: nullableString,
    })
    .strict(),
  personaDocuments: z
    .object({
      ...projectionMetadataShape,
      ...timestampShape,
      captured_at: dateTime,
      id: z.string(),
      persona: nullableString,
      profile: z.string(),
      tagline: nullableString,
      user_id: nullableString,
      version: z.number().int(),
    })
    .strict(),
  topics: z
    .object({
      ...projectionMetadataShape,
      ...timestampShape,
      agent_id: nullableString,
      content: nullableString,
      description: nullableString,
      group_id: nullableString,
      id: z.string(),
      session_id: nullableString,
      status: nullableString,
      title: nullableString,
      user_id: z.string(),
      workspace_id: nullableString,
    })
    .strict(),
  userMemories: z
    .object({
      ...projectionMetadataShape,
      ...timestampShape,
      captured_at: dateTime,
      details: nullableString,
      id: z.string(),
      memory_category: nullableString,
      memory_layer: nullableString,
      status: nullableString,
      summary: nullableString,
      tags: stringArray,
      title: nullableString,
      user_id: nullableString,
    })
    .strict(),
} as const satisfies Record<FtsSearchDocumentEntity, z.ZodType>;

export type FtsSearchDocumentSourceMap = {
  [Entity in FtsSearchDocumentEntity]: z.infer<(typeof FTS_SEARCH_DOCUMENT_SCHEMAS)[Entity]>;
};

export interface FtsSearchDocumentKey<
  Entity extends FtsSearchDocumentEntity = FtsSearchDocumentEntity,
> {
  entity: Entity;
  id: string;
}

export type FtsSearchBuiltDocument = {
  [Entity in FtsSearchDocumentEntity]: FtsSearchDocumentKey<Entity> & {
    source: FtsSearchDocumentSourceMap[Entity];
  };
}[FtsSearchDocumentEntity];

export const parseFtsSearchDocumentSource = <Entity extends FtsSearchDocumentEntity>(
  entity: Entity,
  input: unknown,
): FtsSearchDocumentSourceMap[Entity] =>
  FTS_SEARCH_DOCUMENT_SCHEMAS[entity].parse(input) as FtsSearchDocumentSourceMap[Entity];
