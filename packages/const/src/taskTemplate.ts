import type { InterestAreaKey } from './interests';

export const TASK_TEMPLATE_ICONS = ['github'] as const;

export type TaskTemplateIcon = (typeof TASK_TEMPLATE_ICONS)[number];

export const TASK_TEMPLATE_CATEGORIES = [
  'content-creation',
  'engineering',
  'design',
  'learning-research',
  'business',
  'marketing',
  'product',
  'sales-customer',
  'operations',
  'hr',
  'finance-legal',
  'creator',
  'investing',
  'parenting',
  'health',
  'hobbies',
  'personal-life',
] as const;

export type TaskTemplateCategory = (typeof TASK_TEMPLATE_CATEGORIES)[number];

export type TaskTemplateConnectorSource = 'composio' | 'lobehub';

export interface TaskTemplateConnectorReference {
  /** Short identifier from `LOBEHUB_SKILL_PROVIDERS[i].id` or `COMPOSIO_APP_TYPES[i].identifier`. */
  identifier: string;
  source: TaskTemplateConnectorSource;
}

export interface TaskTemplateConnector extends TaskTemplateConnectorReference {
  /** Whether this connector must be authorized before the task can be created. */
  required: boolean;
}

export interface TaskTemplate {
  category: TaskTemplateCategory;
  connectors: TaskTemplateConnector[];
  cronPattern: string;
  description: string;
  /** Optional icon identifier; consumers resolve it to a component. */
  icon?: TaskTemplateIcon;
  id: number;
  identifier: string;
  instruction: string;
  interests: InterestAreaKey[];
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

export const TASK_TEMPLATE_RECOMMEND_MAX_COUNT = 10;
