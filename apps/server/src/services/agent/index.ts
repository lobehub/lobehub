import { type BuiltinAgentSlug } from '@lobechat/builtin-agents';
import { BUILTIN_AGENTS } from '@lobechat/builtin-agents';
import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_AGENT_CONFIG, DEFAULT_MODEL } from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';
import { type AgentItem, type LobeAgentChatConfig, type LobeAgentConfig } from '@lobechat/types';
import { cleanObject, merge } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { type PartialDeep } from 'type-fest';

import { AGENT_SHARE_ALLOWED_PROVIDERS } from '@/business/agent-share';
import { AgentModel } from '@/database/models/agent';
import { AgentShareModel } from '@/database/models/agentShare';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { normalizeInboxAgentAvatar, normalizeInboxAgentTitle } from '@/database/utils/inboxAgent';
import { getRedisConfig } from '@/envs/redis';
import {
  getJSONFromRedis,
  initializeRedisWithPrefix,
  isRedisEnabled,
  RedisKeyNamespace,
  RedisKeys,
} from '@/libs/redis';
import { getServerDefaultAgentConfig } from '@/server/globalConfig';

import { type UpdateAgentResult } from './type';

const log = debug('lobe-agent:service');

/**
 * Agent config with required id field.
 * Used when returning agent config from database (id is always present).
 */
export type AgentConfigWithId = LobeAgentConfig &
  Pick<AgentItem, 'id' | 'slug' | 'userId' | 'visibility' | 'workspaceId'> & {
    /**
     * Raw callSubAgent chatConfig override, stamped by execAgent alongside the
     * merged chatConfig. The LLM context hints need it to re-apply explicit
     * sub-agent reasoning choices over the user's model-instance defaults.
     */
    subAgentChatConfigOverride?: Partial<LobeAgentChatConfig>;
  };

interface AgentWelcomeData {
  openQuestions: string[];
  welcomeMessage: string;
}

/**
 * Agent Service
 *
 * Encapsulates "mutation + query" logic for agent operations.
 * After performing update operations, returns the updated agent data.
 */
export class AgentService {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly agentModel: AgentModel;
  private readonly userModel: UserModel;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
    this.agentModel = new AgentModel(db, userId, workspaceId);
    this.userModel = new UserModel(db, userId);
  }

  /** Validate the effective selection at configuration boundaries, including inherited defaults. */
  async assertShareModelAllowed(agentId: string, patch: PartialDeep<AgentItem> = {}) {
    if (!AGENT_SHARE_ALLOWED_PROVIDERS) return;

    const agent = await this.agentModel.getAgentConfigById(agentId);
    if (!agent) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });

    const selection = await this.resolveModelSelection({ ...agent, ...patch });
    const { provider } = selection;
    if (!AGENT_SHARE_ALLOWED_PROVIDERS.includes(provider)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Shared agents only support models from: ${AGENT_SHARE_ALLOWED_PROVIDERS.join(', ')}. Switch providers or turn off sharing first.`,
      });
    }
    return selection;
  }

  /** Pin inherited defaults so later account changes cannot alter a published model. */
  async prepareShareModel(agentId: string) {
    const selection = await this.assertShareModelAllowed(agentId);
    if (selection) await this.agentModel.updateConfig(agentId, selection);
  }

  async createInbox() {
    const sessionModel = new SessionModel(this.db, this.userId, this.workspaceId);
    const defaultAgentConfig = getServerDefaultAgentConfig();
    await sessionModel.createInbox(defaultAgentConfig);
  }

  /**
   * Get a builtin agent by slug, creating it if it doesn't exist.
   * This is a generic interface for all builtin agents (page-copilot, inbox, etc.)
   *
   * The returned agent config is merged with:
   * 1. DEFAULT_AGENT_CONFIG (hardcoded defaults)
   * 2. Server's globalDefaultAgentConfig (from environment variable DEFAULT_AGENT_CONFIG)
   * 3. The actual agent config from database
   * 4. Avatar from builtin-agents package definition (if available)
   *
   * This ensures the frontend always receives a complete config with model/provider.
   */
  async getBuiltinAgent(slug: string) {
    // Fetch agent and defaultAgentConfig in parallel
    const [agent, defaultAgentConfig] = await Promise.all([
      this.agentModel.getBuiltinAgent(slug),
      this.userModel.getUserSettingsDefaultAgentConfig(),
    ]);

    const mergedConfig = this.mergeDefaultConfig(agent, defaultAgentConfig);
    if (!mergedConfig) return null;

    return this.applyBuiltinIdentity(mergedConfig, slug);
  }

  /**
   * Builtin agent rows are provisioned without avatar/title (see
   * `AgentModel.getBuiltinAgent`) — their identity lives in the builtin-agents
   * package definition, and in branding constants for the inbox. Every read
   * path that returns an agent snapshot must re-apply that identity: the
   * client treats `fetchAgentConfig` responses as authoritative full snapshots
   * and replaces its cached entry, so a snapshot missing the avatar clobbers a
   * previously correct one and the UI falls back to the default robot avatar.
   */
  private applyBuiltinIdentity<T extends LobeAgentConfig>(config: T, fallbackSlug?: string): T {
    const slug = (config as { slug?: string | null }).slug ?? fallbackSlug;
    const identity = { slug };
    const normalizedConfig = {
      ...config,
      avatar: normalizeInboxAgentAvatar(config.avatar, identity),
      title: normalizeInboxAgentTitle(config.title, identity),
    };

    // Use builtin avatar as fallback only when DB has no custom avatar
    const builtinAgent = slug ? BUILTIN_AGENTS[slug as BuiltinAgentSlug] : undefined;
    if (builtinAgent?.avatar && !normalizedConfig.avatar) {
      return { ...normalizedConfig, avatar: builtinAgent.avatar };
    }

    return normalizedConfig;
  }

  /**
   * Get agent config by ID or slug with default config merged.
   * Supports both agentId and slug lookup.
   *
   * The returned agent config is merged with:
   * 1. DEFAULT_AGENT_CONFIG (hardcoded defaults)
   * 2. Server's globalDefaultAgentConfig (from environment variable DEFAULT_AGENT_CONFIG)
   * 3. User's defaultAgentConfig (from user settings)
   * 4. The actual agent config from database
   */
  async getAgentConfig(idOrSlug: string): Promise<AgentConfigWithId | null> {
    const [agent, defaultAgentConfig] = await Promise.all([
      this.agentModel.getAgentConfig(idOrSlug),
      this.userModel.getUserSettingsDefaultAgentConfig(),
    ]);

    const config = this.mergeDefaultConfig(agent, defaultAgentConfig) as AgentConfigWithId | null;
    if (!config) return null;

    return this.applyBuiltinIdentity(config);
  }

  /**
   * Get agent config by ID with default config merged.
   *
   * The returned agent config is merged with:
   * 1. DEFAULT_AGENT_CONFIG (hardcoded defaults)
   * 2. Server's globalDefaultAgentConfig (from environment variable DEFAULT_AGENT_CONFIG)
   * 3. User's defaultAgentConfig (from user settings)
   * 4. The actual agent config from database
   * 5. AI-generated welcome data from Redis (if available)
   */
  async getAgentConfigById(agentId: string) {
    const [agent, defaultAgentConfig, welcomeData] = await Promise.all([
      this.agentModel.getAgentConfigById(agentId),
      this.userModel.getUserSettingsDefaultAgentConfig(),
      this.getAgentWelcomeFromRedis(agentId),
    ]);

    const config = this.mergeDefaultConfig(agent, defaultAgentConfig);
    if (!config) return null;

    const normalizedConfig = this.applyBuiltinIdentity(config);

    // Merge AI-generated welcome data if available
    if (welcomeData) {
      return {
        ...normalizedConfig,
        openingMessage: welcomeData.welcomeMessage,
        openingQuestions: welcomeData.openQuestions,
      };
    }

    return normalizedConfig;
  }

  /**
   * The model and provider a run of this agent actually uses: the same
   * `DEFAULT_AGENT_CONFIG` → server default → user default → agent layering
   * as {@link getAgentConfig}, narrowed to those two fields. For read paths
   * that only need to know which model will answer (deriving what media a
   * share visitor may attach, for instance) without loading the agent's
   * knowledge and documents.
   */
  async resolveModelSelection(agent: {
    model?: string | null;
    provider?: string | null;
  }): Promise<{ model: string; provider: string }> {
    const defaultAgentConfig = await this.userModel.getUserSettingsDefaultAgentConfig();
    const merged = this.mergeDefaultConfig(
      { model: agent.model, provider: agent.provider },
      defaultAgentConfig,
    )!;

    // `LobeAgentConfig` types both as optional even though `DEFAULT_AGENT_CONFIG`
    // always supplies them; the fallbacks are those same constants.
    return { model: merged.model ?? DEFAULT_MODEL, provider: merged.provider ?? DEFAULT_PROVIDER };
  }

  /**
   * Get AI-generated welcome data from Redis
   * Returns null if Redis is disabled or data doesn't exist
   */
  private async getAgentWelcomeFromRedis(agentId: string): Promise<AgentWelcomeData | null> {
    try {
      const redisConfig = getRedisConfig();
      if (!isRedisEnabled(redisConfig)) return null;

      const redis = await initializeRedisWithPrefix(redisConfig, RedisKeyNamespace.AI_GENERATION);
      return getJSONFromRedis<AgentWelcomeData>(
        redis,
        RedisKeys.aiGeneration.agentWelcome(agentId),
      );
    } catch (error) {
      // Log error for observability but don't break agent retrieval
      log('Failed to get agent welcome from Redis for agent %s: %O', agentId, error);
      return null;
    }
  }

  /**
   * Merge default config with agent config.
   * Returns null if agent is null/undefined.
   *
   * Merge order (later values override earlier):
   * 1. DEFAULT_AGENT_CONFIG - hardcoded defaults
   * 2. serverDefaultAgentConfig - from environment variable
   * 3. userDefaultAgentConfig - from user settings (defaultAgent.config)
   * 4. agent - actual agent config from database
   *
   * Workspace exception: a workspace is a shared resource, so its agents must
   * NOT inherit any individual member's *personal* default model. Otherwise a
   * shared agent persisted with an empty model (e.g. the workspace inbox)
   * resolves to whoever opens it — the creator's personal default leaks in and
   * the workspace looks "initialized" with their model. For workspace-scoped
   * reads we skip the user layer and fall back to the system default instead.
   */
  private mergeDefaultConfig(
    agent: any,
    defaultAgentConfig: Awaited<ReturnType<UserModel['getUserSettingsDefaultAgentConfig']>>,
  ): LobeAgentConfig | null {
    if (!agent) return null;

    // Merge configs in order: DEFAULT -> server -> [user] -> agent
    const serverDefaultAgentConfig = getServerDefaultAgentConfig();
    const baseConfig = merge(DEFAULT_AGENT_CONFIG, serverDefaultAgentConfig);

    // Skip the personal default layer for workspace-scoped agents (see above).
    if (this.workspaceId) {
      return merge(baseConfig, cleanObject(agent));
    }

    const userDefaultAgentConfig =
      (defaultAgentConfig as { config?: PartialDeep<LobeAgentConfig> })?.config || {};
    const withUserConfig = merge(baseConfig, userDefaultAgentConfig);

    return merge(withUserConfig, cleanObject(agent));
  }

  /**
   * Update agent config and return the updated data
   * Pattern: update + query
   *
   * This method combines config update and querying into a single operation,
   * reducing the need for separate refresh calls and improving performance.
   */
  async updateAgentConfig(
    agentId: string,
    value: PartialDeep<AgentItem>,
  ): Promise<UpdateAgentResult> {
    if (AGENT_SHARE_ALLOWED_PROVIDERS && ('model' in value || 'provider' in value)) {
      const share = await new AgentShareModel(this.db, this.userId).getByAgentId(agentId);
      if (share?.visibility === 'link') {
        const selection = await this.assertShareModelAllowed(agentId, value);
        value = { ...value, ...selection };
      }
    }

    // 1. Execute update
    // `AgentItem` here is the `@lobechat/types` domain shape (plugins:
    // AgentPluginEntry[]); `agentModel.updateConfig` takes the DB-layer
    // AgentItem, whose `plugins` column type is intentionally left as
    // `string[]` (only the domain types are widened for the tri-state
    // rollout, not the JSONB column's compile-time annotation).
    await this.agentModel.updateConfig(agentId, value as any);

    // 2. Query and return updated data (with default config merged)
    const agent = await this.getAgentConfigById(agentId);
    if (!agent) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });

    return { agent: agent as any, success: true };
  }
}
