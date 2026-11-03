import {
  type AgentTemplate,
  type AgentTemplateFetcher,
  normalizeAgentTemplate,
  type RawAgentTemplate,
} from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import i18next from 'i18next';

import { lambdaClient } from '@/libs/trpc/client';
import { normalizeLocale } from '@/locales/resources';

const resolveMarketplaceLocale = () =>
  normalizeLocale(i18next.resolvedLanguage || i18next.language || globalThis.navigator?.language);

export const fetchOnboardingAgentTemplates: AgentTemplateFetcher = async (options) => {
  const data = await lambdaClient.market.agent.getOnboardingFull.query(
    { locale: resolveMarketplaceLocale() },
    { signal: options?.signal },
  );
  if (!data || typeof data !== 'object') return [];

  const templates: AgentTemplate[] = [];
  for (const [category, items] of Object.entries(data)) {
    if (!Array.isArray(items)) continue;
    for (const item of items as RawAgentTemplate[]) {
      const normalized = normalizeAgentTemplate(item, category);
      if (normalized) templates.push(normalized);
    }
  }
  return templates;
};
