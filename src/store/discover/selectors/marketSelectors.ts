import type { MarketUserProfile } from '@/layout/AuthProvider/MarketAuth/types';
import type { MarketSkillPackageFile } from '@/services/marketApi';
import type { AgentForkSourceResponse, AgentGroupForkSourceResponse } from '@/types/discover';

import type { MarketAgentGroupStatus, MarketAgentStatus } from '../slices/market/projection';
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

/**
 * Whether the server answered this page of a plugin's agents in this session.
 * A hydrated page may be stale or empty, so "no agents" is only rendered once
 * the first page is confirmed.
 */
const isPluginAgentsConfirmed = (queryKey?: string) => (s: DiscoverStore) =>
  !!queryKey && s.pluginAgentsReplica.entries[queryKey]?.source === 'server';

export const marketSelectors = {
  agentForkSource,
  agentGroupForkSource,
  agentGroupStatus,
  agentStatus,
  isPluginAgentsConfirmed,
  skillPackageFiles,
  userProfile,
};
