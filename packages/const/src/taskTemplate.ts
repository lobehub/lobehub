/**
 * Task Template catalog used by home "Try following tasks" recommendation.
 * I18n keys: `taskTemplate:${id}.title|description|prompt`.
 * Templates requiring third-party OAuth are excluded from this MVP catalog.
 *
 * `interests` values must be keys from `INTEREST_AREAS` in
 * `src/routes/onboarding/config.ts` — that's what `users.interests` stores.
 */
export interface TaskTemplate {
  category: TaskTemplateCategory;
  cronPattern: string;
  id: string;
  interests: string[];
}

export type TaskTemplateCategory =
  | 'content-creation'
  | 'engineering'
  | 'design'
  | 'learning-research'
  | 'business'
  | 'marketing'
  | 'product'
  | 'personal-life';

/** Generic categories used to fill the pool when interest-matched picks are insufficient. */
export const TASK_TEMPLATE_FALLBACK_CATEGORIES: TaskTemplateCategory[] = [
  'personal-life',
  'learning-research',
];

export const taskTemplates: TaskTemplate[] = [
  {
    id: 'daily-topic-pick',
    category: 'content-creation',
    cronPattern: '0 9 * * *',
    interests: ['writing'],
  },
  {
    id: 'oss-intel-daily',
    category: 'engineering',
    cronPattern: '0 9 * * *',
    interests: ['coding'],
  },
  {
    id: 'arxiv-curated-daily',
    category: 'learning-research',
    cronPattern: '0 9 * * *',
    interests: ['education', 'coding'],
  },
  {
    id: 'daily-design-inspiration',
    category: 'design',
    cronPattern: '0 9 * * *',
    interests: ['design'],
  },
  {
    id: 'industry-morning-brief',
    category: 'business',
    cronPattern: '0 8 * * *',
    interests: ['business', 'sales'],
  },
  {
    id: 'marketing-hot-radar',
    category: 'marketing',
    cronPattern: '0 10 * * *',
    interests: ['marketing', 'sales'],
  },
  {
    id: 'user-feedback-daily',
    category: 'product',
    cronPattern: '0 9 * * *',
    interests: ['product'],
  },
  {
    id: 'daily-learning-bite',
    category: 'personal-life',
    cronPattern: '30 7 * * *',
    interests: ['education'],
  },
  {
    id: 'hn-writing-angles',
    category: 'content-creation',
    cronPattern: '0 10 * * *',
    interests: ['writing'],
  },
  {
    id: 'leetcode-daily',
    category: 'engineering',
    cronPattern: '0 19 * * *',
    interests: ['coding'],
  },
  {
    id: 'frontend-weekly-digest',
    category: 'engineering',
    cronPattern: '0 9 * * 1',
    interests: ['coding'],
  },
  {
    id: 'font-of-the-week',
    category: 'design',
    cronPattern: '0 9 * * 3',
    interests: ['design'],
  },
  {
    id: 'competitor-radar-weekly',
    category: 'business',
    cronPattern: '0 10 * * 1',
    interests: ['business'],
  },
  {
    id: 'seo-weekly-report',
    category: 'marketing',
    cronPattern: '0 9 * * 1',
    interests: ['marketing'],
  },
  {
    id: 'feature-ideation-friday',
    category: 'product',
    cronPattern: '0 15 * * 5',
    interests: ['product'],
  },
  {
    id: 'sales-pipeline-review',
    category: 'business',
    cronPattern: '0 17 * * 5',
    interests: ['sales'],
  },
];
