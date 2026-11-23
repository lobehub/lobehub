import {
  type AgentTemplate,
  MarketplaceCategory,
} from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';

import type { DiscoverAssistantItem } from '@/types/discover';

/** What an assistant row or card shows; LobeHub's picks and community agents both map onto it. */
export interface MarketAgentSummary {
  author?: string;
  avatar?: string;
  backgroundColor?: string;
  category?: string;
  description?: string;
  /** Market identifier; adding forks it and the copy remembers it as `forkedFromIdentifier`. */
  id: string;
  /** A group of Agents: it opens the group page and has no "+" (groups are not forked here). */
  isGroup?: boolean;
  pluginCount?: number;
  title: string;
}

/** Order of LobeHub's categories on the page: work first, life last. */
export const AGENT_CATEGORY_ORDER: MarketplaceCategory[] = [
  MarketplaceCategory.ProductManagement,
  MarketplaceCategory.Operations,
  MarketplaceCategory.Engineering,
  MarketplaceCategory.ContentCreation,
  MarketplaceCategory.Marketing,
  MarketplaceCategory.DesignCreative,
  MarketplaceCategory.LearningResearch,
  MarketplaceCategory.BusinessStrategy,
  MarketplaceCategory.SalesCustomer,
  MarketplaceCategory.FinanceLegal,
  MarketplaceCategory.PeopleHR,
  MarketplaceCategory.CreatorEconomy,
  MarketplaceCategory.PersonalLife,
];

/** Featured cards at the top of "All". */
export const FEATURED_COUNT = 3;
/** Rows a category previews (two two-column lines) before "View all". */
export const AGENT_PREVIEW_COUNT = 4;

export const isMarketplaceCategory = (value?: string): value is MarketplaceCategory =>
  !!value && (AGENT_CATEGORY_ORDER as string[]).includes(value);

export const fromTemplate = (template: AgentTemplate): MarketAgentSummary => ({
  author: template.author,
  avatar: template.avatar,
  category: template.category,
  description: template.description,
  id: template.id,
  pluginCount: template.pluginCount,
  title: template.title,
});

export const fromCommunity = (item: DiscoverAssistantItem): MarketAgentSummary => ({
  author: item.author,
  avatar: item.avatar,
  backgroundColor: item.backgroundColor,
  category: item.category,
  description: item.description,
  id: item.identifier,
  isGroup: item.type === 'agent-group',
  pluginCount: item.pluginCount,
  title: item.title || item.identifier,
});

/** Case-insensitive match on the name and the description. */
export const matchAgent = (agent: MarketAgentSummary, query: string) => {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  return [agent.title, agent.description ?? ''].some((text) =>
    text.toLowerCase().includes(keyword),
  );
};

/** LobeHub's picks by category, in `AGENT_CATEGORY_ORDER`, skipping empty ones. */
export const groupTemplates = (templates: AgentTemplate[]) =>
  AGENT_CATEGORY_ORDER.map((category) => ({
    category,
    items: templates.filter((template) => template.category === category).map(fromTemplate),
  })).filter((group) => group.items.length > 0);

/** The most-added picks, one per category so the row is not three of a kind. */
export const pickFeatured = (templates: AgentTemplate[], count = FEATURED_COUNT) => {
  const seen = new Set<string>();
  return templates
    .toSorted((a, b) => (b.forkCount ?? 0) - (a.forkCount ?? 0))
    .filter((template) => {
      if (seen.has(template.category)) return false;
      seen.add(template.category);
      return true;
    })
    .slice(0, count)
    .map(fromTemplate);
};
