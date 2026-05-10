import { type HeterogeneousAgentClientConfig } from '@lobechat/heterogeneous-agents/client';
import { createElement } from 'react';

import type { RecommendedAction } from './types';

/**
 * Build a "Add <Brand> agent" recommendation card for a heterogeneous CLI agent
 * (Claude Code, Codex, …). Eligible only on desktop, when the local CLI is
 * detected, and when the user hasn't already added an agent of that type.
 */
export const buildHeteroAgentAction = (
  config: HeterogeneousAgentClientConfig,
): RecommendedAction => {
  const Icon = config.icon;

  return {
    ctaKey: 'recommendations.heteroAgent.cta',
    descriptionKey: 'recommendations.heteroAgent.description',
    execute: (ctx) => ctx.createHeteroAgent(config),
    i18nValues: { name: config.title },
    icon: createElement(Icon, { size: 16 }),
    id: `hetero-agent:${config.type}`,
    isEligible: (ctx) => {
      if (!ctx.isDesktop) return false;
      if (!ctx.heteroDetections[config.type]?.available) return false;
      return !ctx.agents.some((a) => a.heterogeneousType === config.type);
    },
    priority: 10,
    tagKey: 'recommendations.heteroAgent.tag',
    titleKey: 'recommendations.heteroAgent.title',
  };
};
