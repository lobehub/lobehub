/**
 * Agent Marketplace Tool Identifier
 */
export const AgentMarketplaceIdentifier = 'lobe-agent-marketplace';

/**
 * Agent Marketplace API Names
 */
export const AgentMarketplaceApiName = {
  /** Open the Marketplace picker with category hints. */
  showAgentMarketplace: 'showAgentMarketplace',
  /** Record the user's template selection. Usually framework-handled. */
  submitAgentPick: 'submitAgentPick',
} as const;

export type AgentMarketplaceApiNameType =
  (typeof AgentMarketplaceApiName)[keyof typeof AgentMarketplaceApiName];

/**
 * Curated categories sourced from the marketplace onboarding-full API.
 * Slugs match the top-level keys of the API response.
 */
export enum MarketplaceCategory {
  BusinessStrategy = 'business-strategy',
  ContentCreation = 'content-creation',
  CreatorEconomy = 'creator-economy',
  DesignCreative = 'design-creative',
  Engineering = 'engineering',
  FinanceLegal = 'finance-legal',
  LearningResearch = 'learning-research',
  Marketing = 'marketing',
  Operations = 'operations',
  PeopleHR = 'people-hr',
  PersonalLife = 'personal-life',
  ProductManagement = 'product-management',
  SalesCustomer = 'sales-customer',
}

export const MARKETPLACE_CATEGORY_VALUES = Object.values(MarketplaceCategory);

/**
 * A single agent template shown in the marketplace picker.
 */
export interface AgentTemplate {
  /** Optional emoji or image URL — falls back to a category default in the UI. */
  avatar?: string;
  category: MarketplaceCategory;
  /** Optional one-line capability summary. Upstream marketplace API may omit this. */
  description?: string;
  /** Marketplace identifier (e.g. 'agent-template-copywriter'). */
  id: string;
  /** Human-readable title (English Title Case). */
  title: string;
}

/**
 * Args to open the Marketplace picker.
 * categoryHints must contain at least one MarketplaceCategory slug and controls tab priority.
 */
export interface ShowAgentMarketplaceArgs {
  categoryHints: MarketplaceCategory[];
  description?: string;
  prompt: string;
  requestId: string;
}

export interface SubmitAgentPickArgs {
  requestId: string;
  /** Template IDs the user selected from the picker. */
  selectedTemplateIds: string[];
}

export type PickStatus = 'pending' | 'submitted';

export interface PickState {
  categoryHints: MarketplaceCategory[];
  description?: string;
  prompt: string;
  requestId: string;
  selectedTemplateIds?: string[];
  status: PickStatus;
  topicId?: string;
}
