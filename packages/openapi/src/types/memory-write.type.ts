import { AsyncTaskStatus, ContextStatusEnum, LayersEnum, TypesEnum } from '@lobechat/types';
import { z } from 'zod';

import { dateTimeSchema } from './common.type';
import {
  MemoryActivitySchema,
  MemoryContextSchema,
  MemoryExperienceSchema,
  MemoryIdentitySchema,
  MemoryPersonaSchema,
  MemoryPreferenceSchema,
} from './memory.type';

const score = z.number().min(0).max(1);

/** An ISO 8601 timestamp the server can parse. */
const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be an ISO 8601 date-time')
  .meta({ format: 'date-time' });

/** Fields every new memory entry carries, whatever its layer. */
const createBase = {
  category: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Free-form memory category, e.g. `work`, `health`. Defaults to `general`.'),
  details: z.string().max(10_000).optional().describe('Longer supporting notes.'),
  memoryType: z
    .enum(TypesEnum)
    .optional()
    .describe('What kind of fact this is. Each layer has its own default.'),
  summary: z.string().trim().min(1).max(2000).describe('One-paragraph overview; it is embedded.'),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  title: z.string().trim().min(1).max(255).describe('Short headline.'),
};

// ==================== Create ====================

export const IDENTITY_RELATIONSHIPS = [
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

export const CreateMemoryIdentitySchema = z
  .object({
    ...createBase,
    description: z.string().trim().min(1).max(4000).describe('Who this person is to the user.'),
    episodicDate: isoDateTime.optional().describe('When the identity fact became true.'),
    relationship: z
      .enum(IDENTITY_RELATIONSHIPS)
      .optional()
      .describe('Relationship to the user; `self` (default) describes the user.'),
    role: z.string().max(255).optional(),
    type: z.enum(['personal', 'professional', 'demographic']).optional(),
  })
  .strict()
  .meta({ id: 'CreateMemoryIdentity' });
export type CreateMemoryIdentity = z.infer<typeof CreateMemoryIdentitySchema>;

export const CreateMemoryPreferenceSchema = z
  .object({
    ...createBase,
    conclusionDirectives: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .describe('The instruction an assistant should follow, in the user’s words.'),
    scorePriority: score.optional().describe('0–1; higher is more important to respect.'),
    suggestions: z.array(z.string().max(1000)).max(20).optional(),
  })
  .strict()
  .meta({ id: 'CreateMemoryPreference' });
export type CreateMemoryPreference = z.infer<typeof CreateMemoryPreferenceSchema>;

export const CreateMemoryContextSchema = z
  .object({
    ...createBase,
    currentStatus: z.enum(ContextStatusEnum).optional().describe('Defaults to `ongoing`.'),
    description: z.string().trim().min(1).max(10_000).describe('The situation or project.'),
    scoreImpact: score.optional(),
    scoreUrgency: score.optional(),
    type: z.string().max(100).optional().describe('Archetype, e.g. `project`, `goal`.'),
  })
  .strict()
  .meta({ id: 'CreateMemoryContext' });
export type CreateMemoryContext = z.infer<typeof CreateMemoryContextSchema>;

export const CreateMemoryActivitySchema = z
  .object({
    ...createBase,
    endsAt: isoDateTime.optional(),
    feedback: z.string().max(4000).optional().describe('How it went or felt.'),
    narrative: z.string().trim().min(1).max(10_000).describe('What happened.'),
    notes: z.string().max(10_000).optional(),
    startsAt: isoDateTime.optional(),
    status: z.string().max(50).optional().describe('Defaults to `pending`.'),
    timezone: z.string().max(100).optional().describe('IANA zone, e.g. `Asia/Shanghai`.'),
    type: z.string().max(50).optional().describe('e.g. `meeting`, `call`. Defaults to `other`.'),
  })
  .strict()
  .meta({ id: 'CreateMemoryActivity' });
export type CreateMemoryActivity = z.infer<typeof CreateMemoryActivitySchema>;

export const CreateMemoryExperienceSchema = z
  .object({
    ...createBase,
    action: z.string().max(4000).optional(),
    keyLearning: z.string().max(4000).optional(),
    possibleOutcome: z.string().max(4000).optional(),
    reasoning: z.string().max(4000).optional(),
    scoreConfidence: score.optional(),
    situation: z.string().trim().min(1).max(4000).describe('The situation that was faced.'),
  })
  .strict()
  .meta({ id: 'CreateMemoryExperience' });
export type CreateMemoryExperience = z.infer<typeof CreateMemoryExperienceSchema>;

// ==================== Update ====================

/** At least one field must be sent. */
const nonEmpty = <T extends z.ZodObject>(schema: T) =>
  schema.refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'Send at least one field to update',
  });

export const UpdateMemoryIdentitySchema = nonEmpty(
  z
    .object({
      description: z.string().max(4000).optional(),
      episodicDate: isoDateTime.optional(),
      relationship: z.enum(IDENTITY_RELATIONSHIPS).optional(),
      role: z.string().max(255).optional(),
      tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
      type: z.enum(['personal', 'professional', 'demographic']).optional(),
    })
    .strict(),
).meta({ id: 'UpdateMemoryIdentity' });
export type UpdateMemoryIdentity = z.infer<typeof UpdateMemoryIdentitySchema>;

export const UpdateMemoryPreferenceSchema = nonEmpty(
  z
    .object({
      conclusionDirectives: z.string().max(4000).optional(),
      suggestions: z.string().max(10_000).optional().describe('Newline-separated suggestions.'),
    })
    .strict(),
).meta({ id: 'UpdateMemoryPreference' });
export type UpdateMemoryPreference = z.infer<typeof UpdateMemoryPreferenceSchema>;

export const UpdateMemoryContextSchema = nonEmpty(
  z
    .object({
      currentStatus: z.string().max(50).optional(),
      description: z.string().max(10_000).optional(),
      title: z.string().max(255).optional(),
    })
    .strict(),
).meta({ id: 'UpdateMemoryContext' });
export type UpdateMemoryContext = z.infer<typeof UpdateMemoryContextSchema>;

export const UpdateMemoryActivitySchema = nonEmpty(
  z
    .object({
      narrative: z.string().max(10_000).optional(),
      notes: z.string().max(10_000).optional(),
      status: z.string().max(50).optional(),
    })
    .strict(),
).meta({ id: 'UpdateMemoryActivity' });
export type UpdateMemoryActivity = z.infer<typeof UpdateMemoryActivitySchema>;

export const UpdateMemoryExperienceSchema = nonEmpty(
  z
    .object({
      action: z.string().max(4000).optional(),
      keyLearning: z.string().max(4000).optional(),
      situation: z.string().max(4000).optional(),
    })
    .strict(),
).meta({ id: 'UpdateMemoryExperience' });
export type UpdateMemoryExperience = z.infer<typeof UpdateMemoryExperienceSchema>;

// ==================== Search ====================

const layerLimit = z.number().int().min(0).max(50).optional();

export const MemorySearchRequestSchema = z
  .object({
    categories: z.array(z.string().trim().min(1)).max(20).optional(),
    effort: z
      .enum(['low', 'medium', 'high'])
      .optional()
      .describe('Retrieval depth; defaults to the user’s memory setting.'),
    layers: z.array(z.enum(LayersEnum)).max(5).optional().describe('Limit to these layers.'),
    queries: z
      .array(z.string().trim().min(1).max(8000))
      .max(10)
      .optional()
      .describe('Natural-language queries; required unless `topicId` is sent.'),
    tags: z.array(z.string().trim().min(1)).max(20).optional(),
    topicId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Retrieve the memories relevant to a conversation topic, using its user messages as the query. Mutually exclusive with `queries`.',
      ),
    topK: z
      .object({
        activities: layerLimit,
        contexts: layerLimit,
        experiences: layerLimit,
        identities: layerLimit,
        preferences: layerLimit,
      })
      .strict()
      .optional()
      .describe('Per-layer result caps.'),
  })
  .strict()
  .refine((value) => Boolean(value.topicId) !== Boolean(value.queries?.length), {
    message: 'Send either `queries` or `topicId`',
    path: ['queries'],
  })
  .meta({ id: 'MemorySearchRequest' });
export type MemorySearchRequest = z.infer<typeof MemorySearchRequestSchema>;

const layerMeta = z
  .object({ hasMore: z.boolean(), returned: z.number().int(), total: z.number().int() })
  .strict();

/** Search hits never echo the owner. */
const withoutOwner = <T extends z.ZodObject>(schema: T) => schema.omit({ userId: true } as never);

export const MemorySearchResultSchema = z
  .object({
    activities: z.array(withoutOwner(MemoryActivitySchema)),
    contexts: z.array(withoutOwner(MemoryContextSchema)),
    experiences: z.array(withoutOwner(MemoryExperienceSchema)),
    identities: z.array(withoutOwner(MemoryIdentitySchema)),
    meta: z
      .object({
        appliedQueries: z.array(z.string()),
        layers: z
          .object({
            activities: layerMeta,
            contexts: layerMeta,
            experiences: layerMeta,
            identities: layerMeta,
            preferences: layerMeta,
          })
          .strict(),
      })
      .strict()
      .nullable(),
    preferences: z.array(withoutOwner(MemoryPreferenceSchema)),
  })
  .strict()
  .meta({ id: 'MemorySearchResult' });
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;

// ==================== Extraction ====================

export const StartMemoryExtractionSchema = z
  .object({
    fromDate: isoDateTime.optional().describe('Only topics updated at or after this time.'),
    toDate: isoDateTime.optional().describe('Only topics updated at or before this time.'),
  })
  .strict()
  .refine(
    (value) =>
      !value.fromDate || !value.toDate || new Date(value.fromDate) <= new Date(value.toDate),
    { message: '`fromDate` cannot be later than `toDate`', path: ['fromDate'] },
  )
  .meta({ id: 'StartMemoryExtraction' });
export type StartMemoryExtraction = z.infer<typeof StartMemoryExtractionSchema>;

export const MemoryExtractionTaskIdParamSchema = z.object({ id: z.string().uuid() });

export const MemoryExtractionTaskSchema = z
  .object({
    deduped: z
      .boolean()
      .describe('True when an extraction was already running and that task is returned instead.'),
    error: z.object({ message: z.string(), name: z.string() }).strict().nullable(),
    id: z.string().describe('Async task id; poll `GET /memories/extractions/{id}`.'),
    progress: z
      .object({ completedTopics: z.number().int(), totalTopics: z.number().int().nullable() })
      .strict(),
    range: z.object({ from: dateTimeSchema.nullable(), to: dateTimeSchema.nullable() }).strict(),
    status: z.enum(AsyncTaskStatus),
  })
  .strict()
  .meta({ id: 'MemoryExtractionTask' });
export type MemoryExtractionTask = z.infer<typeof MemoryExtractionTaskSchema>;

// ==================== Persona ====================

export const PersonaVersionIdParamSchema = z.object({ id: z.string().trim().min(1).max(255) });

export const RestoredPersonaSchema = z
  .object({
    historyId: z.string().describe('The version that was restored.'),
    persona: MemoryPersonaSchema,
    version: z.number().int().describe('Version number of the new current persona.'),
  })
  .strict()
  .meta({ id: 'RestoredPersona' });
export type RestoredPersona = z.infer<typeof RestoredPersonaSchema>;
