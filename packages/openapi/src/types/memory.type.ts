import type {
  UserMemoryActivityWithoutVectors,
  UserMemoryContextWithoutVectors,
  UserMemoryExperienceWithoutVectors,
  UserMemoryIdentityWithoutVectors,
  UserMemoryPreferenceWithoutVectors,
  UserPersonaDocumentHistory,
} from '@lobechat/types';
import { z } from 'zod';

import { dateTimeSchema, jsonObjectSchema } from './common.type';

/** Id of a single memory entry inside its category. */
export const MemoryEntryIdParamSchema = z.object({
  id: z.string().min(1),
});
export type MemoryEntryIdParam = z.infer<typeof MemoryEntryIdParamSchema>;

/** The six memory categories a client can read and prune individually. */
export const MEMORY_CATEGORIES = [
  'identities',
  'preferences',
  'contexts',
  'activities',
  'experiences',
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MemoryCategoryParamSchema = z.object({
  category: z.enum(MEMORY_CATEGORIES),
});
export type MemoryCategoryParam = z.infer<typeof MemoryCategoryParamSchema>;

export const MemoryEntryPathParamSchema = MemoryCategoryParamSchema.extend(
  MemoryEntryIdParamSchema.shape,
);
export type MemoryEntryPathParam = z.infer<typeof MemoryEntryPathParamSchema>;

// ==================== Response Schemas ====================

/** The current persona document: its prose plus the one-line tagline. */
export const MemoryPersonaSchema = z
  .object({ content: z.string(), summary: z.string() })
  .strict()
  .meta({ id: 'MemoryPersona' });

/** One persona revision, newest first. */
export const MemoryPersonaVersionSchema = z
  .object({
    createdAt: dateTimeSchema,
    id: z.string(),
    nextVersion: z.number().int().nullable(),
    previousVersion: z.number().int().nullable(),
    snapshotPersona: z.string().nullable(),
    snapshotTagline: z.string().nullable(),
  } satisfies Record<
    keyof Pick<
      UserPersonaDocumentHistory,
      'createdAt' | 'id' | 'nextVersion' | 'previousVersion' | 'snapshotPersona' | 'snapshotTagline'
    >,
    z.ZodType
  >)
  .strict()
  .meta({ id: 'MemoryPersonaVersion' });

const memoryEntryBase = {
  accessedAt: dateTimeSchema,
  capturedAt: dateTimeSchema,
  createdAt: dateTimeSchema,
  id: z.string(),
  /** Free-form extraction metadata (source topic, model…). */
  metadata: jsonObjectSchema.nullable(),
  tags: z.array(z.string()).nullable(),
  type: z.string().nullable(),
  updatedAt: dateTimeSchema,
  userId: z.string().nullable(),
};

const associatedEntitySchema = z
  .object({
    extra: jsonObjectSchema.optional(),
    name: z.string().optional(),
    type: z.string().optional(),
  })
  .strict();

export const MemoryIdentitySchema = z
  .object({
    ...memoryEntryBase,
    description: z.string().nullable(),
    entityId: z.string().nullable(),
    episodicDate: dateTimeSchema.nullable(),
    relationship: z.string().nullable(),
    role: z.string().nullable(),
    userMemoryId: z.string().nullable(),
  } satisfies Record<keyof UserMemoryIdentityWithoutVectors, z.ZodType>)
  .strict()
  .meta({ id: 'MemoryIdentity' });

export const MemoryPreferenceSchema = z
  .object({
    ...memoryEntryBase,
    appliesToEntityId: z.string().nullable(),
    conclusionDirectives: z.string().nullable(),
    evidenceCount: z.number().int(),
    evidenceSource: z.enum(['stated', 'reported', 'inferred']).nullable(),
    holderEntityId: z.string().nullable(),
    lastEvidenceAt: dateTimeSchema.nullable(),
    scope: z.string().nullable(),
    scorePriority: z.number().nullable(),
    suggestions: z.string().nullable(),
    userMemoryId: z.string().nullable(),
  } satisfies Record<keyof UserMemoryPreferenceWithoutVectors, z.ZodType>)
  .strict()
  .meta({ id: 'MemoryPreference' });

export const MemoryContextSchema = z
  .object({
    ...memoryEntryBase,
    associatedObjects: z.array(associatedEntitySchema).nullable(),
    associatedSubjects: z.array(associatedEntitySchema).nullable(),
    currentStatus: z.string().nullable(),
    description: z.string().nullable(),
    firstSeenAt: dateTimeSchema.nullable(),
    lastEvidenceAt: dateTimeSchema.nullable(),
    nextSteps: z.array(z.string()).nullable(),
    now: z.string().nullable(),
    openQuestions: z.array(z.string()).nullable(),
    scoreImpact: z.number().nullable(),
    scoreUrgency: z.number().nullable(),
    synthesizedAt: dateTimeSchema.nullable(),
    title: z.string().nullable(),
    userMemoryId: z.string().nullable(),
    userMemoryIds: z.array(z.string()).nullable(),
  } satisfies Record<keyof UserMemoryContextWithoutVectors, z.ZodType>)
  .strict()
  .meta({ id: 'MemoryContext' });

export const MemoryActivitySchema = z
  .object({
    ...memoryEntryBase,
    associatedLocations: z
      .array(
        z
          .object({
            address: z.string().optional(),
            name: z.string().optional(),
            tags: z.array(z.string()).optional(),
            type: z.string().optional(),
          })
          .strict(),
      )
      .nullable(),
    associatedObjects: z.array(associatedEntitySchema).nullable(),
    associatedSubjects: z.array(associatedEntitySchema).nullable(),
    dossierId: z.string().nullable(),
    endsAt: dateTimeSchema.nullable(),
    feedback: z.string().nullable(),
    injectable: z.boolean(),
    narrative: z.string().nullable(),
    notes: z.string().nullable(),
    startsAt: dateTimeSchema.nullable(),
    status: z.string(),
    timezone: z.string().nullable(),
    type: z.string(),
    userMemoryId: z.string().nullable(),
  } satisfies Record<keyof UserMemoryActivityWithoutVectors, z.ZodType>)
  .strict()
  .meta({ id: 'MemoryActivity' });

export const MemoryExperienceSchema = z
  .object({
    ...memoryEntryBase,
    action: z.string().nullable(),
    keyLearning: z.string().nullable(),
    possibleOutcome: z.string().nullable(),
    reasoning: z.string().nullable(),
    scoreConfidence: z.number().nullable(),
    situation: z.string().nullable(),
    userMemoryId: z.string().nullable(),
  } satisfies Record<keyof UserMemoryExperienceWithoutVectors, z.ZodType>)
  .strict()
  .meta({ id: 'MemoryExperience' });

/**
 * The entries of the requested category: every identity, or the newest few
 * entries of any other layer. Which array shape comes back is decided by the
 * `category` path parameter.
 */
export const MemoryCategoryEntriesSchema = z
  .union([
    z.array(MemoryIdentitySchema),
    z.array(MemoryPreferenceSchema),
    z.array(MemoryContextSchema),
    z.array(MemoryActivitySchema),
    z.array(MemoryExperienceSchema),
  ])
  .meta({ id: 'MemoryCategoryEntries' });
