import type { AgentTemplate, MarketplaceCategory } from '../types';
import { MARKETPLACE_CATEGORY_VALUES } from '../types';

const MARKETPLACE_CATEGORY_SET = new Set<string>(MARKETPLACE_CATEGORY_VALUES);

export interface RawAgentTemplate {
  avatar?: string;
  description?: string;
  identifier?: string;
  name?: string;
}

/** API response shape: top-level keys are MarketplaceCategory slugs. */
export type OnboardingFullResponse = Record<string, RawAgentTemplate[]>;

export const normalizeAgentTemplate = (
  item: RawAgentTemplate,
  category: string,
): AgentTemplate | undefined => {
  if (!item.identifier || !item.name) return undefined;
  if (!MARKETPLACE_CATEGORY_SET.has(category)) return undefined;
  return {
    avatar: item.avatar,
    category: category as MarketplaceCategory,
    description: item.description,
    id: item.identifier,
    title: item.name,
  };
};

export interface FetchAgentTemplatesOptions {
  signal?: AbortSignal;
}

export type AgentTemplateFetcher = (
  options?: FetchAgentTemplatesOptions,
) => Promise<AgentTemplate[]>;

const defaultFetcher: AgentTemplateFetcher = async () => {
  throw new Error(
    '[AgentMarketplace] Agent templates fetcher is not configured. ' +
      'Call setAgentTemplatesFetcher in your app initialization.',
  );
};

let currentFetcher: AgentTemplateFetcher = defaultFetcher;

export const setAgentTemplatesFetcher = (fetcher: AgentTemplateFetcher): void => {
  currentFetcher = fetcher;
};

export const fetchAgentTemplates: AgentTemplateFetcher = (options) => currentFetcher(options);

export const getTemplatesByCategories = (
  templates: AgentTemplate[],
  categories: string[],
): AgentTemplate[] => {
  if (categories.length === 0) return templates;
  const set = new Set(categories);
  return templates.filter((t) => set.has(t.category));
};

export const getTemplatesByCategoryPriority = (
  templates: AgentTemplate[],
  categories: string[],
): AgentTemplate[] => {
  if (categories.length === 0) return templates;

  const priority = new Map(categories.map((category, index) => [category, index]));

  return [...templates].sort((a, b) => {
    const aPriority = priority.get(a.category) ?? Number.MAX_SAFE_INTEGER;
    const bPriority = priority.get(b.category) ?? Number.MAX_SAFE_INTEGER;

    return aPriority - bPriority;
  });
};
