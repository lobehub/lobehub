import type { InterestAreaKey } from './interests';

export const TASK_TEMPLATE_ICONS = ['github'] as const;

export type TaskTemplateIcon = (typeof TASK_TEMPLATE_ICONS)[number];

export type TaskTemplateSkillSource = 'composio' | 'lobehub';

export interface TaskTemplateSkillRequirement {
  /** Short identifier from `LOBEHUB_SKILL_PROVIDERS[i].id` or `COMPOSIO_APP_TYPES[i].identifier`. */
  provider: string;
  source: TaskTemplateSkillSource;
}

export type TaskTemplateCategory =
  | 'content-creation'
  | 'engineering'
  | 'design'
  | 'learning-research'
  | 'business'
  | 'marketing'
  | 'product'
  | 'sales-customer'
  | 'operations'
  | 'hr'
  | 'finance-legal'
  | 'creator'
  | 'investing'
  | 'parenting'
  | 'health'
  | 'hobbies'
  | 'personal-life';

export interface TaskTemplate {
  category: TaskTemplateCategory;
  cronPattern: string;
  description: string;
  /** Optional icon identifier; consumers resolve it to a component. */
  icon?: TaskTemplateIcon;
  id: number;
  instruction: string;
  interests: InterestAreaKey[];
  /** Skills that enrich the brief but are not required to run it. */
  optionalSkills?: TaskTemplateSkillRequirement[];
  /** Skill dependencies. The `source` field routes the connection flow. */
  requiresSkills?: TaskTemplateSkillRequirement[];
  title: string;
}

/**
 * Categories that only make sense in a personal context. When the recommendation
 * is requested from inside a workspace, every template under these categories
 * is removed from the candidate pool — both matched and fallback — so a team
 * dashboard never surfaces "bedtime gratitude" / "weekly family finance" etc.
 */
export const TASK_TEMPLATE_PERSONAL_ONLY_CATEGORIES: TaskTemplateCategory[] = [
  'parenting',
  'health',
  'hobbies',
  'personal-life',
];

export const TASK_TEMPLATE_RECOMMEND_COUNT = 3;
