import type { InterestAreaKey } from './interests';

/**
 * Task Template catalog used by home "Try following tasks" recommendation.
 * I18n keys: `taskTemplate:${id}.title|description|prompt`.
 *
 * `interests` values must be canonical interest area keys — that's what
 * predefined `users.interests` entries store.
 */

/**
 * Identifier for a per-template icon override. The renderer maps each value to
 * a concrete icon component; keep this union small and stable so consumers can
 * exhaustively type their registries.
 */
export const TASK_TEMPLATE_ICONS = ['github'] as const;

export type TaskTemplateIcon = (typeof TASK_TEMPLATE_ICONS)[number];

export interface TaskTemplate {
  category: TaskTemplateCategory;
  cronPattern: string;
  /** Optional icon identifier; consumers resolve it to a component. */
  icon?: TaskTemplateIcon;
  id: string;
  interests: InterestAreaKey[];
  /** Skills that enrich the brief but are not required to run it. */
  optionalSkills?: TaskTemplateSkillRequirement[];
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

/** Generic categories used to fill the pool when interest-matched picks are insufficient. */
export const TASK_TEMPLATE_FALLBACK_CATEGORIES: TaskTemplateCategory[] = [
  'personal-life',
  'learning-research',
];

export const TASK_TEMPLATE_RECOMMEND_COUNT = 3;

export const taskTemplates: TaskTemplate[] = [
  // content-creation
  {
    id: 'daily-topic-pick',
    category: 'content-creation',
    cronPattern: '0 9 * * *',
    interests: ['writing'],
  },
  {
    id: 'hot-topic-radar',
    category: 'content-creation',
    cronPattern: '0 10 * * *',
    interests: ['writing'],
  },
  {
    id: 'headline-inspiration',
    category: 'content-creation',
    cronPattern: '0 10 * * *',
    interests: ['writing'],
  },
  {
    id: 'viral-content-breakdown',
    category: 'content-creation',
    cronPattern: '0 10 * * *',
    interests: ['writing'],
  },
  {
    id: 'twitter-weekly-recap',
    category: 'content-creation',
    cronPattern: '0 10 * * 1',
    interests: ['writing', 'creator'],
    requiresSkills: [{ provider: 'twitter', source: 'lobehub' }],
  },
  {
    id: 'youtube-weekly-recap',
    category: 'content-creation',
    cronPattern: '0 9 * * 1',
    interests: ['writing', 'creator'],
    requiresSkills: [{ provider: 'youtube', source: 'klavis' }],
  },
  {
    id: 'competitor-creator-tracking',
    category: 'content-creation',
    cronPattern: '0 9 * * *',
    interests: ['writing', 'creator'],
  },
  {
    id: 'content-calendar-weekly',
    category: 'content-creation',
    cronPattern: '0 20 * * 0',
    interests: ['writing', 'creator'],
    optionalSkills: [{ provider: 'notion', source: 'lobehub' }],
  },

  // engineering
  {
    id: 'oss-intel-daily',
    category: 'engineering',
    cronPattern: '0 9 * * *',
    icon: 'github',
    interests: ['coding'],
  },
  {
    id: 'repo-health-weekly',
    category: 'engineering',
    cronPattern: '0 9 * * 1',
    interests: ['coding'],
    requiresSkills: [{ provider: 'github', source: 'lobehub' }],
  },
  {
    id: 'dependency-security-weekly',
    category: 'engineering',
    cronPattern: '0 10 * * 1',
    interests: ['coding'],
    requiresSkills: [{ provider: 'github', source: 'lobehub' }],
  },
  {
    id: 'vercel-health-weekly',
    category: 'engineering',
    cronPattern: '0 10 * * 1',
    interests: ['coding'],
    requiresSkills: [{ provider: 'vercel', source: 'lobehub' }],
  },
  {
    id: 'linear-sprint-daily',
    category: 'engineering',
    cronPattern: '30 8 * * *',
    interests: ['coding', 'product'],
    requiresSkills: [{ provider: 'linear', source: 'lobehub' }],
  },
  {
    id: 'tech-trend-weekly',
    category: 'engineering',
    cronPattern: '0 8 * * 1',
    interests: ['coding'],
  },
  {
    id: 'keyword-tech-feed',
    category: 'engineering',
    cronPattern: '0 10 * * *',
    interests: ['coding'],
  },

  // design
  {
    id: 'daily-design-inspiration',
    category: 'design',
    cronPattern: '0 9 * * *',
    interests: ['design'],
  },
  {
    id: 'design-trend-weekly',
    category: 'design',
    cronPattern: '0 9 * * 1',
    interests: ['design'],
  },
  {
    id: 'figma-files-cleanup',
    category: 'design',
    cronPattern: '0 17 * * 5',
    interests: ['design'],
    requiresSkills: [{ provider: 'figma', source: 'klavis' }],
  },
  {
    id: 'aigc-prompt-inspiration',
    category: 'design',
    cronPattern: '0 10 * * *',
    interests: ['design'],
  },
  {
    id: 'brand-watch-weekly',
    category: 'design',
    cronPattern: '0 10 * * 1',
    interests: ['design'],
  },
  {
    id: 'font-color-weekly',
    category: 'design',
    cronPattern: '0 10 * * 3',
    interests: ['design'],
  },

  // learning-research
  {
    id: 'arxiv-curated-daily',
    category: 'learning-research',
    cronPattern: '0 9 * * *',
    interests: ['education'],
  },
  {
    id: 'must-read-papers-weekly',
    category: 'learning-research',
    cronPattern: '0 20 * * 0',
    interests: ['education'],
  },
  {
    id: 'language-morning-bite',
    category: 'learning-research',
    cronPattern: '30 7 * * *',
    interests: ['education'],
  },
  {
    id: 'industry-research-weekly',
    category: 'learning-research',
    cronPattern: '0 9 * * 1',
    interests: ['education', 'business'],
  },

  // business
  {
    id: 'industry-morning-brief',
    category: 'business',
    cronPattern: '0 8 * * *',
    interests: ['business'],
  },
  {
    id: 'competitor-radar-daily',
    category: 'business',
    cronPattern: '0 9 * * *',
    interests: ['business'],
  },
  {
    id: 'funding-intel-daily',
    category: 'business',
    cronPattern: '0 10 * * *',
    interests: ['business'],
  },
  {
    id: 'macro-economy-weekly',
    category: 'business',
    cronPattern: '0 8 * * 1',
    interests: ['business', 'investing'],
  },
  {
    id: 'weekly-meeting-brief',
    category: 'business',
    cronPattern: '30 8 * * 1',
    interests: ['business'],
  },

  // marketing
  {
    id: 'marketing-hot-radar',
    category: 'marketing',
    cronPattern: '0 10 * * *',
    interests: ['marketing'],
  },
  {
    id: 'ad-creative-inspiration',
    category: 'marketing',
    cronPattern: '0 10 * * *',
    interests: ['marketing'],
  },
  {
    id: 'brand-mention-daily',
    category: 'marketing',
    cronPattern: '0 18 * * *',
    interests: ['marketing'],
    requiresSkills: [{ provider: 'twitter', source: 'lobehub' }],
  },
  {
    id: 'seo-weekly-report',
    category: 'marketing',
    cronPattern: '0 9 * * 1',
    interests: ['marketing'],
  },
  {
    id: 'newsletter-perf-weekly',
    category: 'marketing',
    cronPattern: '0 10 * * 1',
    interests: ['marketing'],
    requiresSkills: [{ provider: 'gmail', source: 'klavis' }],
  },
  {
    id: 'kol-collab-calendar',
    category: 'marketing',
    cronPattern: '0 9 * * 1',
    interests: ['marketing'],
    requiresSkills: [{ provider: 'airtable', source: 'klavis' }],
  },
  {
    id: 'hubspot-funnel-daily',
    category: 'marketing',
    cronPattern: '0 9 * * *',
    interests: ['marketing', 'sales'],
    requiresSkills: [{ provider: 'hubspot', source: 'klavis' }],
  },

  // product
  {
    id: 'user-feedback-daily',
    category: 'product',
    cronPattern: '0 9 * * *',
    interests: ['product'],
  },
  {
    id: 'competitor-update-daily',
    category: 'product',
    cronPattern: '0 10 * * *',
    interests: ['product'],
  },
  {
    id: 'standup-brief',
    category: 'product',
    cronPattern: '30 8 * * *',
    interests: ['product'],
    requiresSkills: [{ provider: 'linear', source: 'lobehub' }],
  },
  {
    id: 'iteration-recap-weekly',
    category: 'product',
    cronPattern: '0 17 * * 5',
    interests: ['product'],
    requiresSkills: [{ provider: 'linear', source: 'lobehub' }],
  },
  {
    id: 'core-metric-daily',
    category: 'product',
    cronPattern: '0 9 * * *',
    interests: ['product'],
  },
  {
    id: 'user-interview-schedule',
    category: 'product',
    cronPattern: '0 9 * * 1',
    interests: ['product'],
    requiresSkills: [{ provider: 'google-calendar', source: 'klavis' }],
  },
  {
    id: 'prd-review-reminder',
    category: 'product',
    cronPattern: '0 15 * * 5',
    interests: ['product'],
    requiresSkills: [{ provider: 'notion', source: 'lobehub' }],
  },

  // sales-customer
  {
    id: 'daily-followup-list',
    category: 'sales-customer',
    cronPattern: '0 9 * * *',
    interests: ['sales'],
    requiresSkills: [{ provider: 'hubspot', source: 'klavis' }],
  },
  {
    id: 'renewal-risk-weekly',
    category: 'sales-customer',
    cronPattern: '0 9 * * 1',
    interests: ['sales'],
    requiresSkills: [{ provider: 'hubspot', source: 'klavis' }],
  },
  {
    id: 'deal-pipeline-weekly',
    category: 'sales-customer',
    cronPattern: '0 16 * * 5',
    interests: ['sales'],
    requiresSkills: [{ provider: 'hubspot', source: 'klavis' }],
  },
  {
    id: 'key-account-radar',
    category: 'sales-customer',
    cronPattern: '0 9 * * *',
    interests: ['sales'],
  },
  {
    id: 'zendesk-ticket-daily',
    category: 'sales-customer',
    cronPattern: '0 9 * * *',
    interests: ['sales'],
    requiresSkills: [{ provider: 'zendesk', source: 'klavis' }],
  },

  // operations
  {
    id: 'morning-brief',
    category: 'operations',
    cronPattern: '0 8 * * *',
    interests: ['operations'],
    requiresSkills: [{ provider: 'google-calendar', source: 'klavis' }],
  },
  {
    id: 'meeting-brief',
    category: 'operations',
    cronPattern: '30 8 * * *',
    interests: ['operations'],
    requiresSkills: [{ provider: 'google-calendar', source: 'klavis' }],
  },
  {
    id: 'calendar-conflict-check',
    category: 'operations',
    cronPattern: '30 7 * * *',
    interests: ['operations'],
    requiresSkills: [{ provider: 'google-calendar', source: 'klavis' }],
  },
  {
    id: 'friday-wrap-list',
    category: 'operations',
    cronPattern: '0 16 * * 5',
    interests: ['operations'],
    requiresSkills: [{ provider: 'linear', source: 'lobehub' }],
  },

  // hr
  {
    id: 'recruit-funnel-daily',
    category: 'hr',
    cronPattern: '0 9 * * *',
    interests: ['hr'],
    requiresSkills: [{ provider: 'airtable', source: 'klavis' }],
  },
  {
    id: 'onboarding-buddy-weekly',
    category: 'hr',
    cronPattern: '0 9 * * 1',
    interests: ['hr'],
    requiresSkills: [{ provider: 'notion', source: 'lobehub' }],
  },
  {
    id: 'team-status-weekly',
    category: 'hr',
    cronPattern: '0 9 * * 1',
    interests: ['hr'],
    requiresSkills: [{ provider: 'google-calendar', source: 'klavis' }],
  },

  // finance-legal
  {
    id: 'precious-metals-daily',
    category: 'finance-legal',
    cronPattern: '0 16 * * *',
    interests: ['finance-legal', 'investing'],
  },
  {
    id: 'pre-market-brief',
    category: 'finance-legal',
    cronPattern: '0 9 * * *',
    interests: ['finance-legal', 'investing'],
  },
  {
    id: 'cashflow-weekly',
    category: 'finance-legal',
    cronPattern: '0 9 * * 1',
    interests: ['finance-legal'],
    requiresSkills: [{ provider: 'airtable', source: 'klavis' }],
  },
  {
    id: 'contract-expiry-weekly',
    category: 'finance-legal',
    cronPattern: '0 9 * * 1',
    interests: ['finance-legal'],
    requiresSkills: [{ provider: 'notion', source: 'lobehub' }],
  },
  {
    id: 'regulation-watch-weekly',
    category: 'finance-legal',
    cronPattern: '0 10 * * 1',
    interests: ['finance-legal'],
  },
  {
    id: 'invoice-collection-daily',
    category: 'finance-legal',
    cronPattern: '0 10 * * *',
    interests: ['finance-legal'],
    requiresSkills: [{ provider: 'gmail', source: 'klavis' }],
  },

  // creator
  {
    id: 'cross-platform-engagement-daily',
    category: 'creator',
    cronPattern: '0 9 * * *',
    interests: ['creator'],
    requiresSkills: [{ provider: 'twitter', source: 'lobehub' }],
  },
  {
    id: 'brand-collab-weekly',
    category: 'creator',
    cronPattern: '0 10 * * 1',
    interests: ['creator'],
  },
  {
    id: 'follower-growth-weekly',
    category: 'creator',
    cronPattern: '0 10 * * 1',
    interests: ['creator'],
    requiresSkills: [{ provider: 'twitter', source: 'lobehub' }],
  },
  {
    id: 'youtube-channel-weekly',
    category: 'creator',
    cronPattern: '0 9 * * 1',
    interests: ['creator'],
    requiresSkills: [{ provider: 'youtube', source: 'klavis' }],
  },
  {
    id: 'monetization-opportunity-weekly',
    category: 'creator',
    cronPattern: '0 10 * * 3',
    interests: ['creator'],
  },

  // investing
  {
    id: 'portfolio-daily',
    category: 'investing',
    cronPattern: '0 16 * * *',
    interests: ['investing'],
  },
  {
    id: 'crypto-market-daily',
    category: 'investing',
    cronPattern: '0 9 * * *',
    interests: ['investing'],
  },

  // parenting
  {
    id: 'child-growth-weekly',
    category: 'parenting',
    cronPattern: '0 9 * * 1',
    interests: ['parenting'],
  },
  {
    id: 'child-study-weekly',
    category: 'parenting',
    cronPattern: '0 20 * * 0',
    interests: ['parenting', 'education'],
  },
  {
    id: 'family-finance-weekly',
    category: 'parenting',
    cronPattern: '0 20 * * 0',
    interests: ['parenting', 'finance-legal'],
    requiresSkills: [{ provider: 'google-sheets', source: 'klavis' }],
  },
  {
    id: 'family-task-schedule',
    category: 'parenting',
    cronPattern: '0 8 * * 1',
    interests: ['parenting'],
    optionalSkills: [{ provider: 'google-calendar', source: 'klavis' }],
  },

  // health
  {
    id: 'diet-log-companion',
    category: 'health',
    cronPattern: '0 21 * * *',
    interests: ['health'],
  },

  // hobbies
  {
    id: 'podcast-new-episodes',
    category: 'hobbies',
    cronPattern: '0 9 * * 1',
    interests: ['hobbies'],
  },
  {
    id: 'newsletter-aggregator',
    category: 'hobbies',
    cronPattern: '0 20 * * 0',
    interests: ['hobbies'],
    requiresSkills: [{ provider: 'gmail', source: 'klavis' }],
  },
  {
    id: 'series-update-weekly',
    category: 'hobbies',
    cronPattern: '0 9 * * 1',
    interests: ['hobbies'],
  },
  {
    id: 'travel-inspiration-weekly',
    category: 'hobbies',
    cronPattern: '0 10 * * 3',
    interests: ['hobbies'],
  },
  {
    id: 'watchlist-friday',
    category: 'hobbies',
    cronPattern: '0 18 * * 5',
    interests: ['hobbies'],
  },
  {
    id: 'exhibition-event-weekly',
    category: 'hobbies',
    cronPattern: '0 10 * * 1',
    interests: ['hobbies'],
  },

  // personal-life
  {
    id: 'daily-learning-bite',
    category: 'personal-life',
    cronPattern: '30 7 * * *',
    interests: ['education', 'personal'],
  },
  {
    id: 'sunday-reflection',
    category: 'personal-life',
    cronPattern: '0 21 * * 0',
    interests: ['personal'],
  },
  {
    id: 'morning-ritual',
    category: 'personal-life',
    cronPattern: '0 7 * * *',
    interests: ['personal'],
    optionalSkills: [{ provider: 'google-calendar', source: 'klavis' }],
  },
  {
    id: 'bedtime-gratitude',
    category: 'personal-life',
    cronPattern: '0 22 * * *',
    interests: ['personal'],
    optionalSkills: [{ provider: 'notion', source: 'lobehub' }],
  },
];

export const KNOWN_TASK_TEMPLATE_IDS: ReadonlySet<string> = new Set(taskTemplates.map((t) => t.id));
