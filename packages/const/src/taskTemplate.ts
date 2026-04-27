import {
  BookOpen,
  BookText,
  Brain,
  Crosshair,
  Flame,
  GitBranch,
  Github,
  GitPullRequest,
  Lightbulb,
  type LucideIcon,
  MessageCircle,
  MonitorSmartphone,
  Radar,
  Search,
  Terminal,
  TrendingUp,
  Type,
} from 'lucide-react';

/**
 * Task Template catalog used by home "Try following tasks" recommendation.
 * I18n keys: `taskTemplate:${id}.title|description|prompt`.
 *
 * `interests` values must be keys from `INTEREST_AREAS` in
 * `src/routes/onboarding/config.ts` — that's what `users.interests` stores.
 */
export interface TaskTemplate {
  category: TaskTemplateCategory;
  cronPattern: string;
  /** Per-template icon override. Falls back to a category-level default when omitted. */
  icon?: LucideIcon;
  id: string;
  interests: string[];
  /** Skill dependencies. The `source` field routes the connection flow. */
  requiresSkills?: TaskTemplateSkillRequirement[];
}

export interface TaskTemplateSkillRequirement {
  /** Short identifier from `LOBEHUB_SKILL_PROVIDERS[i].id` or `KLAVIS_SERVER_TYPES[i].identifier`. */
  provider: string;
  source: TaskTemplateSkillSource;
}

export type TaskTemplateSkillSource = 'klavis' | 'lobehub';

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
    icon: Github,
    interests: ['coding'],
  },
  {
    id: 'arxiv-curated-daily',
    category: 'learning-research',
    cronPattern: '0 9 * * *',
    icon: BookOpen,
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
    icon: Radar,
    interests: ['marketing', 'sales'],
  },
  {
    id: 'user-feedback-daily',
    category: 'product',
    cronPattern: '0 9 * * *',
    icon: MessageCircle,
    interests: ['product'],
  },
  {
    id: 'daily-learning-bite',
    category: 'personal-life',
    cronPattern: '30 7 * * *',
    icon: Brain,
    interests: ['education'],
  },
  {
    id: 'hn-writing-angles',
    category: 'content-creation',
    cronPattern: '0 10 * * *',
    icon: Flame,
    interests: ['writing'],
  },
  {
    id: 'leetcode-daily',
    category: 'engineering',
    cronPattern: '0 19 * * *',
    icon: Terminal,
    interests: ['coding'],
  },
  {
    id: 'frontend-weekly-digest',
    category: 'engineering',
    cronPattern: '0 9 * * 1',
    icon: MonitorSmartphone,
    interests: ['coding'],
  },
  {
    id: 'font-of-the-week',
    category: 'design',
    cronPattern: '0 9 * * 3',
    icon: Type,
    interests: ['design'],
  },
  {
    id: 'competitor-radar-weekly',
    category: 'business',
    cronPattern: '0 10 * * 1',
    icon: Crosshair,
    interests: ['business'],
  },
  {
    id: 'seo-weekly-report',
    category: 'marketing',
    cronPattern: '0 9 * * 1',
    icon: Search,
    interests: ['marketing'],
  },
  {
    id: 'feature-ideation-friday',
    category: 'product',
    cronPattern: '0 15 * * 5',
    icon: Lightbulb,
    interests: ['product'],
  },
  {
    id: 'sales-pipeline-review',
    category: 'business',
    cronPattern: '0 17 * * 5',
    icon: TrendingUp,
    interests: ['sales'],
  },
  {
    id: 'github-pr-review-daily',
    category: 'engineering',
    cronPattern: '0 9 * * *',
    icon: GitPullRequest,
    interests: ['coding'],
    requiresSkills: [{ provider: 'github', source: 'lobehub' }],
  },
  {
    id: 'notion-weekly-digest',
    category: 'product',
    cronPattern: '0 9 * * 1',
    icon: BookText,
    interests: ['product', 'writing'],
    requiresSkills: [{ provider: 'notion', source: 'klavis' }],
  },
  {
    id: 'weekly-engineering-digest',
    category: 'engineering',
    cronPattern: '0 17 * * 5',
    icon: GitBranch,
    interests: ['coding', 'product'],
    requiresSkills: [
      { provider: 'github', source: 'lobehub' },
      { provider: 'linear', source: 'lobehub' },
    ],
  },
];
