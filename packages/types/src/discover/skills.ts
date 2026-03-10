import type {
  MarketSkillCategory,
  MarketSkillDetail,
  MarketSkillListItem,
  MarketSkillListResponse,
  SkillCommentListResponse,
  SkillRatingDistribution,
} from '@lobehub/market-sdk';

export enum SkillCategory {
  AgentToAgentProtocols = 'agent-to-agent-protocols',
  AILLMs = 'ai-llms',
  All = 'all',
  AppleAppsServices = 'apple-apps-services',
  BrowserAutomation = 'browser-automation',
  CalendarScheduling = 'calendar-scheduling',
  ClawdbotTools = 'clawdbot-tools',
  CLIUtilities = 'cli-utilities',
  CodingAgentsIDEs = 'coding-agents-ides',
  Communication = 'communication',
  DataAnalytics = 'data-analytics',
  DevOpsCloud = 'devops-cloud',
  Finance = 'finance',
  Gaming = 'gaming',
  GitGitHub = 'git-github',
  HealthFitness = 'health-fitness',
  ImageVideoGeneration = 'image-video-generation',
  IOSMacOSDevelopment = 'ios-macos-development',
  MarketingSales = 'marketing-sales',
  MediaStreaming = 'media-streaming',
  Moltbook = 'moltbook',
  NotesPKM = 'notes-pkm',
  PDFDocuments = 'pdf-documents',
  PersonalDevelopment = 'personal-development',
  ProductivityTasks = 'productivity-tasks',
  SearchResearch = 'search-research',
  SecurityPasswords = 'security-passwords',
  SelfHostedAutomation = 'self-hosted-automation',
  ShoppingEcommerce = 'shopping-ecommerce',
  SmartHomeIoT = 'smart-home-iot',
  SpeechTranscription = 'speech-transcription',
  Transportation = 'transportation',
  WebFrontendDevelopment = 'web-frontend-development',
}

export enum SkillSorts {
  CreatedAt = 'createdAt',
  InstallCount = 'installCount',
  Name = 'name',
  Relevance = 'relevance',
  Stars = 'stars',
  UpdatedAt = 'updatedAt',
}

export enum SkillNavKey {
  Installation = 'installation',
  Overview = 'overview',
  Related = 'related',
  Resources = 'resources',
  Skill = 'skill',
  Version = 'version',
}

export interface DiscoverSkillItem extends Omit<MarketSkillListItem, 'commentCount'> {
  commentCount?: number;
  homepage?: string;
  ratingAvg?: number;
}

export interface SkillQueryParams {
  category?: string;
  locale?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: SkillSorts;
}

export interface SkillListResponse extends MarketSkillListResponse {
  categories?: SkillCategoryItem[];
}

export interface DiscoverSkillDetail extends MarketSkillDetail {
  comments?: SkillCommentListResponse;
  downloadUrl?: string;
  github?: {
    stars?: number;
    url?: string;
  };
  homepage?: string;
  ratingDistribution?: SkillRatingDistribution;
  related?: DiscoverSkillItem[];
}

export type SkillCategoryItem = MarketSkillCategory;
