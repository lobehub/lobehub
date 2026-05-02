import {
  type AgentTemplate,
  type AgentTemplateFetcher,
  normalizeAgentTemplate,
  type RawAgentTemplate,
} from '@lobechat/builtin-tool-agent-marketplace';

import { lambdaClient } from '@/libs/trpc/client';

export const fetchOnboardingAgentTemplates: AgentTemplateFetcher = async () => {
  const data = await lambdaClient.market.agent.getOnboardingFull.query();
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
