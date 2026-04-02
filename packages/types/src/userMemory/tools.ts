import { z } from 'zod';

import type { UserMemoryIdentity } from './identity';
import type {
  UserMemoryActivity,
  UserMemoryContext,
  UserMemoryExperience,
  UserMemoryPreference,
} from './layers';
import { LayersEnum } from './shared';

const stringArrayFieldSchema = z.preprocess(
  (value) => (typeof value === 'string' ? [value] : value),
  z.array(z.string().trim().min(1)),
);

const enumArrayFieldSchema = <T extends z.EnumLike>(
  schema: z.ZodNativeEnum<T> | z.ZodEnum<[string, ...string[]]>,
) => z.preprocess((value) => (typeof value === 'string' ? [value] : value), z.array(schema));

const searchMemoryTimeFieldSchema = z.enum([
  'capturedAt',
  'createdAt',
  'endsAt',
  'episodicDate',
  'startsAt',
  'updatedAt',
]);

const searchMemoryLayerLimitSchema = z.object({
  activities: z.number().int().min(0).optional(),
  contexts: z.number().int().min(0).optional(),
  experiences: z.number().int().min(0).optional(),
  identities: z.number().int().min(0).optional(),
  preferences: z.number().int().min(0).optional(),
});

const searchMemoryTimeRangeSchema = z.object({
  end: z.coerce.date().optional(),
  field: searchMemoryTimeFieldSchema.optional(),
  start: z.coerce.date().optional(),
});

const searchMemoryPresetTimeSelectorSchema = z.enum([
  'currentMonth',
  'currentWeek',
  'currentYear',
  'lastMonth',
  'lastWeek',
  'lastWeekdays',
  'lastWeekend',
  'lastYear',
  'today',
  'yesterday',
]);

type SearchMemoryPresetTimeSelector = z.infer<typeof searchMemoryPresetTimeSelectorSchema>;

export type SearchMemoryTimeIntent =
  | { selector: SearchMemoryPresetTimeSelector }
  | { date: Date; selector: 'day' }
  | { month: number; selector: 'month'; year: number }
  | {
      anchor: 'today' | 'yesterday' | SearchMemoryTimeIntent;
      offsetDays: number;
      selector: 'relativeDay';
    }
  | { end?: Date; selector: 'range'; start?: Date }
  | { selector: 'year'; year: number };

const searchMemoryDayIntentSchema = z.object({
  date: z.coerce.date(),
  selector: z.literal('day'),
});

const searchMemoryMonthIntentSchema = z.object({
  month: z.number().int().min(1).max(12),
  selector: z.literal('month'),
  year: z.number().int().min(1970).max(9999),
});

const searchMemoryRangeIntentSchema = z
  .object({
    end: z.coerce.date().optional(),
    selector: z.literal('range'),
    start: z.coerce.date().optional(),
  })
  .refine((value) => Boolean(value.start || value.end), {
    message: 'range selector requires start or end',
    path: ['start'],
  });

const searchMemoryYearIntentSchema = z.object({
  selector: z.literal('year'),
  year: z.number().int().min(1970).max(9999),
});

const searchMemoryLegacyRelativeDayAnchorSchema = z.enum(['today', 'yesterday']);

const searchMemoryTimeIntentSchema: z.ZodType<SearchMemoryTimeIntent> = z.lazy(() =>
  z.union([
    z.object({
      selector: searchMemoryPresetTimeSelectorSchema,
    }),
    searchMemoryDayIntentSchema,
    searchMemoryMonthIntentSchema,
    z.object({
      anchor: z.union([searchMemoryLegacyRelativeDayAnchorSchema, searchMemoryTimeIntentSchema]),
      offsetDays: z.number().int(),
      selector: z.literal('relativeDay'),
    }),
    searchMemoryRangeIntentSchema,
    searchMemoryYearIntentSchema,
  ]),
);

export const searchMemorySchema = z.object({
  categories: stringArrayFieldSchema.optional(),
  effort: z.enum(['low', 'medium', 'high']).optional(),
  labels: stringArrayFieldSchema.optional(),
  layers: enumArrayFieldSchema(z.nativeEnum(LayersEnum)).optional(),
  queries: stringArrayFieldSchema.optional(),
  relationships: stringArrayFieldSchema.optional(),
  status: stringArrayFieldSchema.optional(),
  tags: stringArrayFieldSchema.optional(),
  timeIntent: searchMemoryTimeIntentSchema.optional(),
  timeRange: searchMemoryTimeRangeSchema.optional(),
  topK: searchMemoryLayerLimitSchema.optional(),
  types: stringArrayFieldSchema.optional(),
});

const taxonomyIncludeSchema = z.enum([
  'categories',
  'labels',
  'relationships',
  'roles',
  'statuses',
  'tags',
  'types',
]);

export const queryTaxonomyOptionsSchema = z.object({
  include: enumArrayFieldSchema(taxonomyIncludeSchema).optional(),
  layers: z.array(z.nativeEnum(LayersEnum)).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  q: z.string().trim().optional(),
  timeRange: searchMemoryTimeRangeSchema.optional(),
});

export type SearchMemoryParams = z.infer<typeof searchMemorySchema>;
export type QueryTaxonomyOptionsParams = z.infer<typeof queryTaxonomyOptionsSchema>;

type ActivitySearchMemoryItem = Omit<
  UserMemoryActivity,
  'feedbackVector' | 'narrativeVector' | 'userId'
>;
type ContextSearchMemoryItem = Omit<
  UserMemoryContext,
  'descriptionVector' | 'titleVector' | 'userId'
>;
type ExperienceSearchMemoryItem = Omit<
  UserMemoryExperience,
  'actionVector' | 'keyLearningVector' | 'situationVector' | 'userId'
>;
type IdentitySearchMemoryItem = Omit<UserMemoryIdentity, 'descriptionVector' | 'userId'>;
type PreferenceSearchMemoryItem = Omit<
  UserMemoryPreference,
  'conclusionDirectivesVector' | 'userId'
>;

export interface SearchMemoryLayerMeta {
  hasMore: boolean;
  returned: number;
  total: number;
}

export interface SearchMemoryRecommendationScore {
  categoryAffinity: number;
  clusterBoost: number;
  final: number;
  fuzzy: number;
  keyword: number;
  semantic: number;
  tagAffinity: number;
  temporal: number;
}

export interface SearchMemoryRankingMeta {
  activities?: Record<string, SearchMemoryRecommendationScore>;
  contexts?: Record<string, SearchMemoryRecommendationScore>;
  experiences?: Record<string, SearchMemoryRecommendationScore>;
  identities?: Record<string, SearchMemoryRecommendationScore>;
  preferences?: Record<string, SearchMemoryRecommendationScore>;
}

export interface SearchMemoryResultMeta {
  appliedFilters: Omit<SearchMemoryParams, 'effort' | 'topK'>;
  appliedQueries: string[];
  layers: {
    activities: SearchMemoryLayerMeta;
    contexts: SearchMemoryLayerMeta;
    experiences: SearchMemoryLayerMeta;
    identities: SearchMemoryLayerMeta;
    preferences: SearchMemoryLayerMeta;
  };
  ranking?: SearchMemoryRankingMeta;
}

export interface SearchMemoryResult {
  activities: ActivitySearchMemoryItem[];
  contexts: ContextSearchMemoryItem[];
  experiences: ExperienceSearchMemoryItem[];
  identities?: IdentitySearchMemoryItem[];
  meta?: SearchMemoryResultMeta;
  preferences: PreferenceSearchMemoryItem[];
}

export interface TaxonomyOptionItem {
  count: number;
  layers?: LayersEnum[];
  value: string;
}

export interface QueryTaxonomyOptionsResult {
  categories: TaxonomyOptionItem[];
  hasMore: Partial<Record<z.infer<typeof taxonomyIncludeSchema>, boolean>>;
  labels: TaxonomyOptionItem[];
  relationships: TaxonomyOptionItem[];
  roles: TaxonomyOptionItem[];
  statuses: TaxonomyOptionItem[];
  tags: TaxonomyOptionItem[];
  types: TaxonomyOptionItem[];
}

interface MemoryToolBaseResult {
  message: string;
  success: boolean;
}

export interface AddContextMemoryResult extends MemoryToolBaseResult {
  contextId?: string;
  memoryId?: string;
}

export interface AddActivityMemoryResult extends MemoryToolBaseResult {
  activityId?: string;
  memoryId?: string;
}

export interface AddExperienceMemoryResult extends MemoryToolBaseResult {
  experienceId?: string;
  memoryId?: string;
}

export interface AddIdentityMemoryResult extends MemoryToolBaseResult {
  identityId?: string;
  memoryId?: string;
}

export interface AddPreferenceMemoryResult extends MemoryToolBaseResult {
  memoryId?: string;
  preferenceId?: string;
}

export interface RemoveIdentityMemoryResult extends MemoryToolBaseResult {
  identityId?: string;
  reason?: string;
}

export interface UpdateIdentityMemoryResult extends MemoryToolBaseResult {
  identityId?: string;
}

export type RetrieveMemoryParams = SearchMemoryParams;
export type RetrieveMemoryResult = SearchMemoryResult;
