import { LayersEnum } from '@lobechat/types';
import { z } from 'zod';

import { MemoryTypeSchema } from './common';

/**
 * Preference origin context
 */
export const OriginContextSchema = z.object({
  actor: z.string().describe("Who stated the preference; use 'User' for the user"),
  applicableWhen: z.string().nullable().describe('Conditions where this preference applies'),
  notApplicableWhen: z.string().nullable().describe('Conditions where it does not apply'),
  scenario: z.string().nullable().describe('Applicable scenario or use case'),
  trigger: z.string().nullable().describe('What prompted this preference'),
});

/**
 * Application context for preferences
 */
export const AppContextSchema = z.object({
  app: z.string().nullable().describe('App or product name this applies to'),
  feature: z.string().nullable(),
  route: z.string().nullable(),
  surface: z.string().nullable().describe('e.g., chat, emails, code review, notes'),
});

/**
 * Preference-specific fields
 */
export const WithPreferenceSchema = z.object({
  appContext: AppContextSchema.nullable().describe(
    'Application/surface specific preference, if any',
  ),
  conclusionDirectives: z
    .string()
    .describe(
      "Direct, self-contained instruction to the assistant from the user's perspective (what to do, not how to implement)",
    ),
  extractedLabels: z
    .array(z.string())
    .describe('Model generated tags that summarize the preference facets'),
  extractedScopes: z
    .array(z.string())
    .describe('Array of JSON strings describing preference facets and applicable scopes'),
  originContext: OriginContextSchema.nullable().describe(
    'Context of how/why this preference was expressed',
  ),
  scorePriority: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Numeric prioritization weight (0-1 (0% to 100%)) where higher means more critical to respect',
    ),
  suggestions: z
    .array(z.string())
    .describe('Follow-up actions or assistant guidance derived from the preference'),
  type: z
    .string()
    .describe("High level preference classification (e.g., 'lifestyle', 'communication')"),
});

/**
 * Single preference memory item
 */
export const PreferenceMemoryItemSchema = z.object({
  details: z.string().describe('Optional detailed information'),
  memoryCategory: z.string().describe('Memory category'),
  memoryLayer: z.literal(LayersEnum.Preference).describe('Memory layer'),
  memoryType: MemoryTypeSchema.describe('Memory type'),
  summary: z.string().describe('Concise overview of this specific memory'),
  tags: z.array(z.string()).describe('Model generated tags that summarize the preference facets'),
  title: z.string().describe('Brief descriptive title'),
  withPreference: WithPreferenceSchema,
});

/**
 * Preference memory extraction result
 */
export const PreferenceMemorySchema = z.object({
  memories: z
    .array(PreferenceMemoryItemSchema)
    .describe(
      'Array of extracted preference memory items, could be empty if decided no relevant preference to extract',
    ),
});

export type OriginContext = z.infer<typeof OriginContextSchema>;
export type AppContext = z.infer<typeof AppContextSchema>;
export type WithPreference = z.infer<typeof WithPreferenceSchema>;
export type PreferenceMemoryItem = z.infer<typeof PreferenceMemoryItemSchema>;
export type PreferenceMemory = z.infer<typeof PreferenceMemorySchema>;
