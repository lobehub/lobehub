import type {
  RecommendedTaskTemplate,
  TaskTemplateSkillRequirement,
  TaskTemplateSkillSource,
} from '@lobechat/const';

export type TaskTemplateSkillConnectResult =
  | 'cancel'
  | 'fail'
  | 'popup_blocked'
  | 'success'
  | 'timeout';

export type TaskTemplateSkillRequirementType = 'optional' | 'required';

export interface TaskTemplateAnalyticsContext {
  position: number;
  recommendationBatchId: string;
  template: RecommendedTaskTemplate;
  userInterestCount: number;
}

export interface TaskTemplateCardStateProperties extends Record<string, unknown> {
  has_optional_connect_hint: boolean;
  has_optional_skills: boolean;
  has_required_skills: boolean;
  missing_required_skill_provider: null | string;
  missing_required_skill_source: null | TaskTemplateSkillSource;
  primary_action: 'connect_required' | 'create';
}

const TASK_TEMPLATE_ANALYTICS_ERROR_PREFIX = '[taskTemplate:analytics]';

const getSkillSources = (template: RecommendedTaskTemplate): null | TaskTemplateSkillSource[] => {
  const sources = new Set<TaskTemplateSkillSource>();

  for (const skill of template.requiresSkills ?? []) sources.add(skill.source);
  for (const skill of template.optionalSkills ?? []) sources.add(skill.source);

  return sources.size > 0 ? [...sources] : null;
};

export const createRecommendationBatchId = () =>
  `tt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export const getTaskTemplateCommonAnalyticsProperties = (
  context: TaskTemplateAnalyticsContext,
  spm: string,
) => ({
  fallback_pool: context.template.fallbackPool ?? null,
  position: context.position,
  recommendation_batch_id: context.recommendationBatchId,
  requires_skills: (context.template.requiresSkills?.length ?? 0) > 0,
  skill_sources: getSkillSources(context.template),
  source: context.template.source,
  spm,
  template_category: context.template.category,
  template_id: context.template.id,
  user_interest_count: context.userInterestCount,
});

export const getTaskTemplateListServedProperties = ({
  recommendationBatchId,
  templates,
  userInterestCount,
}: {
  recommendationBatchId: string;
  templates: RecommendedTaskTemplate[];
  userInterestCount: number;
}) => {
  const matchedCount = templates.filter((template) => template.source === 'matched').length;
  const preferredCategoryFallbackCount = templates.filter(
    (template) => template.fallbackPool === 'preferred_category',
  ).length;
  const allCandidatesFallbackCount = templates.filter(
    (template) => template.fallbackPool === 'all_candidates',
  ).length;

  return {
    all_candidates_fallback_count: allCandidatesFallbackCount,
    fallback_count: templates.length - matchedCount,
    matched_count: matchedCount,
    preferred_category_fallback_count: preferredCategoryFallbackCount,
    recommendation_batch_id: recommendationBatchId,
    spm: 'home.task_templates.list_served',
    template_count: templates.length,
    user_interest_count: userInterestCount,
  };
};

export const getTaskTemplateCardStateProperties = ({
  missingRequiredSkill,
  showOptionalHint,
  template,
}: {
  missingRequiredSkill?: Pick<TaskTemplateSkillRequirement, 'provider' | 'source'>;
  showOptionalHint: boolean;
  template: RecommendedTaskTemplate;
}): TaskTemplateCardStateProperties => ({
  has_optional_connect_hint: showOptionalHint,
  has_optional_skills: (template.optionalSkills?.length ?? 0) > 0,
  has_required_skills: (template.requiresSkills?.length ?? 0) > 0,
  missing_required_skill_provider: missingRequiredSkill?.provider ?? null,
  missing_required_skill_source: missingRequiredSkill?.source ?? null,
  primary_action: missingRequiredSkill ? 'connect_required' : 'create',
});

export const getTaskTemplateImpressionStorageKey = ({
  date = new Date(),
  templateId,
  userId,
}: {
  date?: Date;
  templateId: string;
  userId?: string;
}) => {
  const userSegment = userId || 'anonymous';
  return `task-template-impression:${userSegment}:${date.toISOString().slice(0, 10)}:${templateId}`;
};

export const hasTrackedTaskTemplateImpression = (key: string) => {
  try {
    return globalThis.sessionStorage?.getItem(key) === '1';
  } catch (error) {
    console.error(`${TASK_TEMPLATE_ANALYTICS_ERROR_PREFIX} Failed to read impression key`, error);
    return false;
  }
};

export const markTaskTemplateImpressionTracked = (key: string) => {
  try {
    globalThis.sessionStorage?.setItem(key, '1');
  } catch (error) {
    console.error(`${TASK_TEMPLATE_ANALYTICS_ERROR_PREFIX} Failed to write impression key`, error);
  }
};

export const resolveTaskTemplateErrorType = (error: unknown) => {
  if (error instanceof Error) return error.name || 'Error';
  return typeof error;
};
