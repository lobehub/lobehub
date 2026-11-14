import { type MarketUserProfile } from '@/layout/AuthProvider/MarketAuth/types';
import { defineReplica, stableQueryKey } from '@/libs/replica';
import { discoverService } from '@/services/discover';
import { marketApiService, type MarketSkillPackageFile } from '@/services/marketApi';
import type {
  AgentForkSourceResponse,
  AgentGroupForkSourceResponse,
  AgentStatus,
  AssistantListResponse,
} from '@/types/discover';

/**
 * Market reads around one published agent, group or skill that the community
 * detail pages and the agent / group profile headers paint: publish status,
 * fork source, the agents using a plugin, a skill's package files and the
 * viewer's own Market profile.
 *
 * All of them are per identity (`cacheScope`), so an account or workspace
 * switch never paints the previous one's rows. Resource names stay clear of
 * the `CACHE_TIERS` patterns so the SWR persistence layer never stores a second
 * copy of a sync response.
 */

/** Read addressed by one Market identifier (agent, group or skill). */
export interface MarketIdentifierParams {
  identifier: string;
}

/** Entry key of an identifier-addressed read. */
export const marketIdentifierKey = ({ identifier }: MarketIdentifierParams): string => identifier;

/** Persisted entries kept per resource; older identifiers fall back to the network. */
const MAX_PERSISTED_MARKET_ENTRIES = 50;

// ============================== Agent publish status ==============================

/**
 * What the agent profile header needs from the owner's Market agent detail.
 * The full detail carries every version's config; only these fields persist.
 */
export interface MarketAgentStatus {
  /** Set when the agent is a fork; its fork source is a separate read. */
  forkedFromAgentId: string | null;
  /** The latest version is waiting for review (`isValidated === false`). */
  latestVersionUnderReview: boolean;
  status: AgentStatus | null;
}

interface MarketVersionLike {
  isValidated?: boolean;
}

const isLatestVersionUnderReview = (versions: unknown): boolean =>
  Array.isArray(versions) &&
  versions.length > 0 &&
  (versions[0] as MarketVersionLike).isValidated === false;

/**
 * One agent's Market status (`marketAgentStatusMap[identifier]`). The status,
 * fork and review tags of the profile header all read this one entry, so the
 * header costs a single detail request instead of one per tag.
 */
export const marketAgentStatusResource = defineReplica<MarketIdentifierParams, MarketAgentStatus>({
  fetcher: async ({ identifier }) => {
    const detail = await marketApiService.getAgentDetail(identifier);
    return {
      forkedFromAgentId: detail.forkedFromAgentId ? String(detail.forkedFromAgentId) : null,
      latestVersionUnderReview: isLatestVersionUnderReview(
        (detail as { versions?: unknown }).versions,
      ),
      status: (detail.status as AgentStatus | undefined) ?? null,
    };
  },
  key: marketIdentifierKey,
  name: 'discoverMarketAgentStatus',
  persist: { maxEntries: MAX_PERSISTED_MARKET_ENTRIES },
  storage: 'indexedDB',
  version: 1,
});

/** What the group profile header needs from the owner's Market group detail. */
export interface MarketAgentGroupStatus {
  latestVersionUnderReview: boolean;
}

/** One group's Market review status (`marketAgentGroupStatusMap[identifier]`). */
export const marketAgentGroupStatusResource = defineReplica<
  MarketIdentifierParams,
  MarketAgentGroupStatus
>({
  fetcher: async ({ identifier }) => {
    const detail = await marketApiService.getAgentGroupDetail(identifier);
    return { latestVersionUnderReview: isLatestVersionUnderReview(detail?.versions) };
  },
  key: marketIdentifierKey,
  name: 'discoverMarketAgentGroupStatus',
  persist: { maxEntries: MAX_PERSISTED_MARKET_ENTRIES },
  storage: 'indexedDB',
  version: 1,
});

// ============================== Fork source ==============================

/**
 * Where an agent was forked from (`agentForkSourceMap[identifier]`). The
 * community detail tag and the profile header tag share the entry.
 */
export const agentForkSourceResource = defineReplica<
  MarketIdentifierParams,
  AgentForkSourceResponse
>({
  fetcher: ({ identifier }) => marketApiService.getAgentForkSource(identifier),
  key: marketIdentifierKey,
  name: 'discoverAgentForkSource',
  persist: { maxEntries: MAX_PERSISTED_MARKET_ENTRIES },
  storage: 'indexedDB',
  version: 1,
});

/** Where a group was forked from (`agentGroupForkSourceMap[identifier]`). */
export const agentGroupForkSourceResource = defineReplica<
  MarketIdentifierParams,
  AgentGroupForkSourceResponse
>({
  fetcher: ({ identifier }) => marketApiService.getAgentGroupForkSource(identifier),
  key: marketIdentifierKey,
  name: 'discoverAgentGroupForkSource',
  persist: { maxEntries: MAX_PERSISTED_MARKET_ENTRIES },
  storage: 'indexedDB',
  version: 1,
});

// ============================== Agents using a plugin ==============================

/** One page of the agents that use a plugin or skill. */
export interface PluginAgentsParams {
  /** Current UI language; the service localizes the agent copy. */
  locale: string;
  page: number;
  pageSize: number;
  pluginId: string;
}

/** Entry key of one page of a plugin's agents. */
export const pluginAgentsQueryKey = (params: PluginAgentsParams): string => stableQueryKey(params);

/**
 * Agents that use a plugin (`pluginAgentsMap[queryKey]`), one entry per page.
 * The MCP detail and the skill detail both list them from the same endpoint,
 * so the same plugin shares its entries across both surfaces.
 */
export const pluginAgentsResource = defineReplica<PluginAgentsParams, AssistantListResponse>({
  fetcher: ({ page, pageSize, pluginId }) =>
    discoverService.getAgentsByPlugin({ page, pageSize, pluginId }),
  key: pluginAgentsQueryKey,
  name: 'discoverPluginAgents',
  persist: { maxEntries: MAX_PERSISTED_MARKET_ENTRIES },
  storage: 'indexedDB',
  version: 1,
});

// ============================== Skill package files ==============================

/**
 * The text files of a Market skill package (`skillPackageFilesMap[identifier]`),
 * so an uninstalled skill's file tree paints without downloading the zip
 * again. Packages can be large, so fewer entries persist than for the other
 * reads.
 */
export const skillPackageFilesResource = defineReplica<
  MarketIdentifierParams,
  MarketSkillPackageFile[]
>({
  fetcher: ({ identifier }) => marketApiService.getSkillPackageFiles(identifier),
  key: marketIdentifierKey,
  name: 'discoverSkillPackageFiles',
  persist: { maxEntries: 20 },
  storage: 'indexedDB',
  version: 1,
});

// ============================== Market user profile ==============================

export interface MarketUserProfileParams {
  username: string;
}

/** Entry key of one Market profile. */
export const marketUserProfileKey = ({ username }: MarketUserProfileParams): string => username;

/**
 * The signed-in viewer's Market profile (`marketUserProfileMap[username]`).
 * Holds only the public profile fields; the Market session and its tokens stay
 * in the auth provider. `null` (no profile created yet) drops the entry.
 */
export const marketUserProfileResource = defineReplica<
  MarketUserProfileParams,
  MarketUserProfile,
  MarketUserProfile | null
>({
  fetcher: ({ username }) => marketApiService.getUserProfile(username),
  key: marketUserProfileKey,
  name: 'discoverMarketUserProfile',
  storage: 'indexedDB',
  version: 1,
});
