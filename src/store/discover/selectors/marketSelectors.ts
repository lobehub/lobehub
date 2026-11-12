import { type MarketUserProfile } from '@/layout/AuthProvider/MarketAuth/types';
import { type MarketSkillPackageFile } from '@/services/marketApi';
import type {
  AgentForkSourceResponse,
  AgentGroupForkSourceResponse,
  DiscoverAssistantItem,
} from '@/types/discover';

import { pluginAgentsParams } from '../slices/market/action';
import {
  type MarketAgentGroupStatus,
  type MarketAgentStatus,
  pluginAgentsQueryKey,
} from '../slices/market/projection';
import type { DiscoverStore } from '../store';

/**
 * Readers of the market replicas. Every helper takes the `queryKey` the
 * matching fetch hook returned, so a surface never reads another entry.
 */
const agentStatus =
  (queryKey?: string) =>
  (s: DiscoverStore): MarketAgentStatus | undefined =>
    queryKey ? s.marketAgentStatusMap[queryKey] : undefined;

const agentGroupStatus =
  (queryKey?: string) =>
  (s: DiscoverStore): MarketAgentGroupStatus | undefined =>
    queryKey ? s.marketAgentGroupStatusMap[queryKey] : undefined;

const agentForkSource =
  (queryKey?: string) =>
  (s: DiscoverStore): AgentForkSourceResponse['source'] | undefined =>
    queryKey ? s.agentForkSourceMap[queryKey]?.source : undefined;

const agentGroupForkSource =
  (queryKey?: string) =>
  (s: DiscoverStore): AgentGroupForkSourceResponse['source'] | undefined =>
    queryKey ? s.agentGroupForkSourceMap[queryKey]?.source : undefined;

const skillPackageFiles =
  (queryKey?: string) =>
  (s: DiscoverStore): MarketSkillPackageFile[] | undefined =>
    queryKey ? s.skillPackageFilesMap[queryKey] : undefined;

const userProfile =
  (queryKey?: string) =>
  (s: DiscoverStore): MarketUserProfile | undefined =>
    queryKey ? s.marketUserProfileMap[queryKey] : undefined;

export interface PluginAgentPages {
  /** Rows of every loaded page, in page order, up to the first unloaded page. */
  items: DiscoverAssistantItem[];
  /** How many leading pages have a value (hydrated or fetched). */
  loadedPages: number;
  /** Total agents the server reported on the latest loaded page. */
  totalCount?: number;
}

/**
 * The first `pageCount` pages of a plugin's agents, concatenated. Stops at the
 * first page without a value, so a gap never renders out of order. Takes the
 * `pluginAgentsMap` (select it, then derive in `useMemo`) so a render does not
 * build a new list on every unrelated store write.
 */
const pluginAgentPages = (
  pluginAgentsMap: DiscoverStore['pluginAgentsMap'],
  pluginId: string | undefined,
  pageCount: number,
): PluginAgentPages => {
  const items: DiscoverAssistantItem[] = [];
  let loadedPages = 0;
  let totalCount: number | undefined;
  if (!pluginId) return { items, loadedPages };

  for (let page = 1; page <= pageCount; page++) {
    const entry = pluginAgentsMap[pluginAgentsQueryKey(pluginAgentsParams(pluginId, page))];
    if (!entry) break;
    items.push(...entry.items);
    loadedPages = page;
    totalCount = entry.totalCount;
  }
  return { items, loadedPages, totalCount };
};

/**
 * Whether the server answered the first page of a plugin's agents in this
 * session. A hydrated page may be stale or empty, so "no agents" is only
 * rendered once this is true.
 */
const isPluginAgentsConfirmed = (pluginId: string | undefined) => (s: DiscoverStore) =>
  !!pluginId &&
  s.pluginAgentsReplica.entries[pluginAgentsQueryKey(pluginAgentsParams(pluginId, 1))]?.source ===
    'server';

export const marketSelectors = {
  agentForkSource,
  agentGroupForkSource,
  agentGroupStatus,
  agentStatus,
  isPluginAgentsConfirmed,
  pluginAgentPages,
  skillPackageFiles,
  userProfile,
};
