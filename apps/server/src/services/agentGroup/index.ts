import { DEFAULT_AGENT_CONFIG, DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';
import { type LobeAgentConfig } from '@lobechat/types';
import { cleanObject, merge } from '@lobechat/utils';
import { type PartialDeep } from 'type-fest';

import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { type UserModel } from '@/database/models/user';
import { AgentGroupRepository } from '@/database/repositories/agentGroup';
import { type ChatGroupConfig } from '@/database/types/chatGroup';
import { getServerDefaultAgentConfig } from '@/server/globalConfig';

type DefaultAgentConfig = Awaited<ReturnType<UserModel['getUserSettingsDefaultAgentConfig']>>;

/**
 * ChatGroup Service
 *
 * Encapsulates "mutation + query" logic for chat group operations.
 * Handles agent config merging for group members.
 */
export class AgentGroupService {
  private readonly agentModel: AgentModel;
  private readonly chatGroupModel: ChatGroupModel;
  private readonly agentGroupRepo: AgentGroupRepository;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.agentModel = new AgentModel(db, userId, workspaceId);
    this.chatGroupModel = new ChatGroupModel(db, userId, workspaceId);
    this.agentGroupRepo = new AgentGroupRepository(db, userId, workspaceId);
  }

  /**
   * Get group detail by ID.
   */
  getGroupDetail(groupId: string) {
    return this.agentGroupRepo.findByIdWithAgents(groupId);
  }

  /**
   * Get all groups with member details.
   */
  getGroups() {
    return this.chatGroupModel.queryWithMemberDetails();
  }

  /**
   * Delete a group and the agents that belonged to it.
   *
   * The roster read + cleanup used to live here, which cost it two things the
   * model-level version has: it ran OUTSIDE the delete's transaction (an error
   * between the two steps stranded the agents permanently, invisible because
   * they are `virtual`), and it classified members through a visibility-scoped
   * read, so a member another workspace user had flipped back to `private` was
   * never seen and never cleaned up.
   *
   * @param groupId - The group ID to delete
   * @returns The deleted group and list of deleted group-owned agent IDs
   */
  async deleteGroup(groupId: string) {
    const { deletedOwnedAgentIds, group } = await this.chatGroupModel.delete(groupId);

    return {
      deletedVirtualAgentIds: deletedOwnedAgentIds,
      group,
    };
  }

  /**
   * Normalize ChatGroupConfig with defaults.
   * Merges DEFAULT_CHAT_GROUP_CHAT_CONFIG with the provided config.
   */
  normalizeGroupConfig(config?: ChatGroupConfig | null): ChatGroupConfig | undefined {
    return config
      ? {
          ...DEFAULT_CHAT_GROUP_CHAT_CONFIG,
          ...config,
        }
      : undefined;
  }

  /**
   * Merge agents with default configs.
   *
   * Merge order (later values override earlier):
   * 1. DEFAULT_AGENT_CONFIG - hardcoded defaults
   * 2. serverDefaultAgentConfig - from environment variable
   * 3. userDefaultAgentConfig - from user settings
   * 4. agent - actual agent config from database
   *
   * @param defaultAgentConfig - User's default agent config from settings
   * @param agents - Array of agents to merge
   * @returns Merged agents array
   */
  mergeAgentsDefaultConfig<T extends Record<string, any>>(
    defaultAgentConfig: DefaultAgentConfig,
    agents: T[],
  ) {
    const userDefaultAgentConfig =
      (defaultAgentConfig as { config?: PartialDeep<LobeAgentConfig> })?.config || {};

    const serverDefaultAgentConfig = getServerDefaultAgentConfig();
    const baseConfig = merge(DEFAULT_AGENT_CONFIG, serverDefaultAgentConfig);
    const withUserConfig = merge(baseConfig, userDefaultAgentConfig);

    return agents.map((agent) => merge(withUserConfig, cleanObject(agent)) as T);
  }
}
