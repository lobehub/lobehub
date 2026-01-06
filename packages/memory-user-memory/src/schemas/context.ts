import {
  ContextStatusEnum,
  LayersEnum,
  UserMemoryContextObjectType,
  UserMemoryContextSubjectType,
} from '@lobechat/types';
import { z } from 'zod';

import { MemoryTypeSchema } from './common';

export const AssociatedObjectSchema = z.object({
  extra: z
    .string()
    .nullable()
    .describe(
      'Additional metadata about the object, should always be a valid JSON string if present',
    ),
  name: z.string().describe('Name of the associated object'),
  type: z
    .nativeEnum(UserMemoryContextObjectType)
    .describe('Type/category of the associated object'),
});

export const AssociatedSubjectSchema = z.object({
  extra: z
    .string()
    .nullable()
    .describe(
      'Additional metadata about the subject, should always be a valid JSON string if present',
    ),
  name: z.string().describe('Name of the associated subject'),
  type: z
    .nativeEnum(UserMemoryContextSubjectType)
    .describe('Type/category of the associated subject'),
});

/**
 * Context-specific fields
 */
export const WithContextSchema = z.object({
  associatedObjects: z
    .array(AssociatedObjectSchema)
    .describe(
      'Array of objects describing involved roles, entities, or resources, [] empty if none',
    ),
  associatedSubjects: z
    .array(AssociatedSubjectSchema)
    .describe(
      'Array of JSON objects describing involved subjects or participants, [] empty if none',
    ),
  currentStatus: z
    .nativeEnum(ContextStatusEnum)
    .describe(
      "High level status markers (must be one of 'planned', 'ongoing', 'completed', 'aborted', 'on_hold', 'cancelled')",
    ),
  description: z
    .string()
    .describe('Rich narrative describing the situation, timeline, or environment'),
  labels: z.array(z.string()).describe('Model generated tags that summarize the context themes'),
  scoreImpact: z
    .number()
    .min(0)
    .max(1)
    .describe('Numeric score (0-1 (0% to 100%)) describing importance'),
  scoreUrgency: z
    .number()
    .min(0)
    .max(1)
    .describe('Numeric score (0-1 (0% to 100%)) describing urgency'),
  title: z.string().describe('Optional synthesized context headline'),
  type: z
    .string()
    .describe("High level context archetype (e.g., 'project', 'relationship', 'goal')"),
});

/**
 * Single context memory item
 */
export const ContextMemoryItemSchema = z.object({
  details: z.string().describe('Optional detailed information'),
  memoryCategory: z.string().describe('Memory category'),
  memoryLayer: z.literal(LayersEnum.Context).describe('Memory layer'),
  memoryType: MemoryTypeSchema.describe('Memory type'),
  summary: z.string().describe('Concise overview of this specific memory'),
  tags: z.array(z.string()).describe('User defined tags that summarize the context facets'),
  title: z.string().describe('Brief descriptive title'),
  withContext: WithContextSchema,
});

/**
 * Context memory extraction result
 */
export const ContextMemorySchema = z.object({
  memories: z
    .array(ContextMemoryItemSchema)
    .describe(
      'Array of extracted context memory items, could be empty if decided no relevant context to extract',
    ),
});

export type WithContext = z.infer<typeof WithContextSchema>;
export type ContextMemoryItem = z.infer<typeof ContextMemoryItemSchema>;
export type ContextMemory = z.infer<typeof ContextMemorySchema>;
