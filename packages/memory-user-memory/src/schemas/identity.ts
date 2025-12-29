import { LayersEnum, MergeStrategyEnum } from '@lobechat/types';
import { z } from 'zod';

import { MemoryTypeSchema } from './common';

export const RELATIONSHIP_ENUM = [
  'self',
  'father',
  'mother',
  'son',
  'daughter',
  'brother',
  'sister',
  'sibling',
  'husband',
  'wife',
  'spouse',
  'partner',
  'couple',
  'friend',
  'colleague',
  'coworker',
  'classmate',
  'mentor',
  'mentee',
  'manager',
  'teammate',
  'grandfather',
  'grandmother',
  'grandson',
  'granddaughter',
  'uncle',
  'aunt',
  'nephew',
  'niece',
  'other',
] as const;

const RelationshipEnum = z.enum(RELATIONSHIP_ENUM);
const IdentityTypeEnum = z.enum(['professional', 'personal', 'demographic']);

export const AddIdentityActionSchema = z
  .object({
    details: z.union([z.string(), z.null()]).describe('Optional detailed information'),
    memoryCategory: z.string().describe('Memory category'),
    memoryLayer: z.literal(LayersEnum.Identity).describe('Memory layer'),
    memoryType: MemoryTypeSchema.describe('Memory type'),
    summary: z.string().describe('Concise overview of this specific memory'),
    tags: z.array(z.string()).describe('Model generated tags that summarize the identity facets'),
    title: z
      .string()
      .describe('Honorific-style, concise descriptor (strength + domain/milestone), avoid bare job titles; e.g., "Trusted open-source maintainer", "Specializes in low-latency infra", "Former Aliyun engineer", "Cares for rescue cats"'),
    withIdentity: z
      .object({
        description: z.string(),
        episodicDate: z.union([z.string(), z.null()]),
        extractedLabels: z.array(z.string()),
        relationship: RelationshipEnum,
        role: z
          .string()
          .describe('Role explicitly mentioned for this identity entry (e.g., "platform engineer", "caregiver"); keep neutral and only use when evidence exists'),
        scoreConfidence: z.number(),
        sourceEvidence: z.union([z.string(), z.null()]),
        type: IdentityTypeEnum,
      })
      .strict(),
  })
  .strict();

export const UpdateIdentityActionSchema = z
  .object({
    id: z.string(),
    mergeStrategy: z.nativeEnum(MergeStrategyEnum),
    set: z.object({
      details: z
        .string()
        .nullable()
        .describe('Optional detailed information, use null for omitting the field'),
      memoryCategory: z
        .string()
        .nullable()
        .describe('Memory category, use null for omitting the field'),
      memoryType: MemoryTypeSchema.describe('Memory type, use null for omitting the field'),
      summary: z
        .string()
        .nullable()
        .describe('Concise overview of this specific memory, use null for omitting the field'),
      tags: z
        .array(z.string())
        .nullable()
        .describe(
          'Model generated tags that summarize the identity facets, use null for omitting the field',
        ),
      title: z
        .string()
        .nullable()
        .describe('Honorific-style, concise descriptor (strength + domain/milestone), avoid bare job titles; e.g., "Trusted open-source maintainer", "Specializes in low-latency infra", "Former Aliyun engineer", "Cares for rescue cats"; use null for omitting the field'),
      withIdentity: z
        .object({
          description: z.string().nullable(),
          episodicDate: z.string().nullable(),
          extractedLabels: z.array(z.string()).nullable(),
          // TODO: OpenAI requires `required` fields to be always present, while enum fields cannot be null
          relationship: z
            .string()
            .describe(`Possible values: ${RELATIONSHIP_ENUM.join(' | ')}`)
            .nullable(),
          role: z
            .string()
            .describe('Role explicitly mentioned for this identity entry (e.g., "platform engineer", "caregiver"); keep existing when not updated; use null for omitting the field')
            .nullable(),
          scoreConfidence: z.number().nullable(),
          sourceEvidence: z.string().nullable(),
          // TODO: OpenAI requires `required` fields to be always present, while enum fields cannot be null
          type: z
            .string()
            .describe(`Possible values: ${IdentityTypeEnum.options.join(' | ')}`)
            .nullable(),
        })
        .strict(),
    }),
  })
  .strict();

export const RemoveIdentityActionSchema = z
  .object({
    id: z.string(),
    reason: z.string(),
  })
  .strict();

export const IdentityActionsSchema = z
  .object({
    add: z
      .array(AddIdentityActionSchema)
      .nullable()
      .describe('Identity entries to add; use an empty array when nothing to add'),
    remove: z
      .array(RemoveIdentityActionSchema)
      .nullable()
      .describe('Identity entries to remove; use an empty array when nothing to remove'),
    update: z
      .array(UpdateIdentityActionSchema)
      .nullable()
      .describe('Identity entries to update; use an empty array when nothing to update'),
  })
  .strict();

export const WithIdentitySchema = z
  .object({
    actions: IdentityActionsSchema,
  })
  .strict();

export type IdentityActions = z.infer<typeof IdentityActionsSchema>;
export type AddIdentityAction = z.infer<typeof AddIdentityActionSchema>;
export type UpdateIdentityAction = z.infer<typeof UpdateIdentityActionSchema>;
export type RemoveIdentityAction = z.infer<typeof RemoveIdentityActionSchema>;
