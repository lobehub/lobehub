import { SkillCategory, SkillSorts } from '@/types/discover';

export enum SkillTabKey {
  AILLMs = 'ai-llms',
  CodingAgent = 'coding-agents-ides',
  DevOpsCloud = 'devops-cloud',
  Discover = 'discover',
  New = 'new',
  Productivity = 'productivity-tasks',
  Trending = 'trending',
  WebFrontend = 'web-frontend-development',
}

export interface SkillTabConfig {
  category?: SkillCategory;
  isCategory?: boolean;
  key: SkillTabKey;
  labelKey: string;
  sort?: SkillSorts;
}

export const SKILL_TABS: SkillTabConfig[] = [
  {
    isCategory: false,
    key: SkillTabKey.Discover,
    labelKey: 'skills.tabs.discover',
  },
  {
    isCategory: false,
    key: SkillTabKey.Trending,
    labelKey: 'skills.tabs.trending',
    sort: SkillSorts.InstallCount,
  },
  {
    isCategory: false,
    key: SkillTabKey.New,
    labelKey: 'skills.tabs.new',
    sort: SkillSorts.CreatedAt,
  },
  {
    category: SkillCategory.CodingAgentsIDEs,
    isCategory: true,
    key: SkillTabKey.CodingAgent,
    labelKey: 'skills.categories.coding-agents-ides.name',
  },
  {
    category: SkillCategory.WebFrontendDevelopment,
    isCategory: true,
    key: SkillTabKey.WebFrontend,
    labelKey: 'skills.categories.web-frontend-development.name',
  },
  {
    category: SkillCategory.DevOpsCloud,
    isCategory: true,
    key: SkillTabKey.DevOpsCloud,
    labelKey: 'skills.categories.devops-cloud.name',
  },
  {
    category: SkillCategory.AILLMs,
    isCategory: true,
    key: SkillTabKey.AILLMs,
    labelKey: 'skills.categories.ai-llms.name',
  },
  {
    category: SkillCategory.ProductivityTasks,
    isCategory: true,
    key: SkillTabKey.Productivity,
    labelKey: 'skills.categories.productivity-tasks.name',
  },
];
