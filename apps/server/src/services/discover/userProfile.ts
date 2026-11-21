import { discoverUrl } from '@lobechat/const';
import {
  type DiscoverAssistantItem,
  type DiscoverPluginItem,
  type DiscoverSkillItem,
  type DiscoverUserProfile,
} from '@lobechat/types';
import { type UserInfoResponse } from '@lobehub/market-sdk';

import type { DiscoverService } from './index';
import { isMarketNotFound, log } from './utils';

// ============================== User Profile ==============================

/**
 * Get user profile and their published agents by username
 */
export const getUserInfo = async (
  service: DiscoverService,
  params: {
    locale?: string;
    username: string;
  },
): Promise<DiscoverUserProfile | undefined> => {
  log('getUserInfo: params=%O', params);
  const { username, locale } = params;

  try {
    // Call Market SDK to get user info
    const response = (await service.market.user.getUserInfo(username, {
      locale,
    })) as UserInfoResponse & {
      agentGroups?: any[];
      favoriteAgentGroups?: any[];
      favoriteAgents?: any[];
      forkedAgentGroups?: any[];
      forkedAgents?: any[];
      plugins?: any[];
      skills?: any[];
    };

    if (!response?.user) {
      log('getUserInfo: user not found for username=%s', username);
      return undefined;
    }

    const {
      user,
      agents,
      agentGroups,
      forkedAgents,
      forkedAgentGroups,
      favoriteAgents,
      favoriteAgentGroups,
      skills,
      plugins,
    } = response;

    // Transform agents to DiscoverAssistantItem format
    const transformedAgents: DiscoverAssistantItem[] = (agents || []).map((agent: any) => ({
      author: user.displayName || user.userName || user.namespace || '',
      avatar: agent.avatar || '',
      category: agent.category as any,
      config: {} as any,
      createdAt: agent.createdAt,
      description: agent.description || '',
      forkCount: agent.forkCount,
      homepage: discoverUrl('assistant', agent.identifier),
      identifier: agent.identifier,
      installCount: agent.installCount,
      isValidated: agent.isValidated,
      knowledgeCount: agent.knowledgeCount || 0,
      pluginCount: agent.pluginCount || 0,
      schemaVersion: 1,
      status: agent.status,
      tags: agent.tags || [],
      title: agent.name || agent.identifier,
      tokenUsage: agent.tokenUsage || 0,
    }));

    // Transform agentGroups to DiscoverGroupAgentItem format
    const transformedAgentGroups = (agentGroups || []).map((group: any) => ({
      author: user.displayName || user.userName || user.namespace || '',
      avatar: group.avatar || '👥',
      category: group.category as any,
      createdAt: group.createdAt,
      description: group.description || '',
      forkCount: group.forkCount,
      homepage: discoverUrl('group_agent', group.identifier),
      identifier: group.identifier,
      installCount: group.installCount || 0,
      isFeatured: group.isFeatured || false,
      isOfficial: group.isOfficial || false,
      isValidated: group.isValidated,
      memberCount: 0, // Will be populated from memberAgents in detail view
      schemaVersion: 1,
      status: group.status,
      tags: group.tags || [],
      title: group.name || group.identifier,
      updatedAt: group.updatedAt,
    }));

    // Transform forkedAgents to DiscoverAssistantItem format
    const transformedForkedAgents: DiscoverAssistantItem[] = (forkedAgents || []).map(
      (agent: any) => ({
        author: user.displayName || user.userName || user.namespace || '',
        avatar: agent.avatar || '',
        category: agent.category as any,
        config: {} as any,
        createdAt: agent.createdAt,
        description: agent.description || '',
        forkCount: agent.forkCount || 0,
        forkedFromAgentId: agent.forkedFromAgentId || null,
        homepage: discoverUrl('assistant', agent.identifier),
        identifier: agent.identifier,
        installCount: agent.installCount,
        isValidated: agent.isValidated,
        knowledgeCount: agent.knowledgeCount || 0,
        pluginCount: agent.pluginCount || 0,
        schemaVersion: 1,
        status: agent.status,
        tags: agent.tags || [],
        title: agent.name || agent.identifier,
        tokenUsage: agent.tokenUsage || 0,
      }),
    );

    // Transform forkedAgentGroups to DiscoverGroupAgentItem format
    const transformedForkedAgentGroups = (forkedAgentGroups || []).map((group: any) => ({
      author: user.displayName || user.userName || user.namespace || '',
      avatar: group.avatar || '👥',
      category: group.category as any,
      createdAt: group.createdAt,
      description: group.description || '',
      forkCount: group.forkCount || 0,
      forkedFromGroupId: group.forkedFromGroupId || null,
      homepage: discoverUrl('group_agent', group.identifier),
      identifier: group.identifier,
      installCount: group.installCount || 0,
      isFeatured: group.isFeatured || false,
      isOfficial: group.isOfficial || false,
      isValidated: group.isValidated,
      memberCount: 0, // Will be populated from memberAgents in detail view
      schemaVersion: 1,
      status: group.status,
      tags: group.tags || [],
      title: group.name || group.identifier,
      updatedAt: group.updatedAt,
    }));

    // Transform favoriteAgents to DiscoverAssistantItem format
    const transformedFavoriteAgents: DiscoverAssistantItem[] = (favoriteAgents || []).map(
      (agent: any) => ({
        author: agent.author || '',
        avatar: agent.avatar || '',
        category: agent.category as any,
        config: {} as any,
        createdAt: agent.createdAt,
        description: agent.description || '',
        forkCount: agent.forkCount || 0,
        forkedFromAgentId: agent.forkedFromAgentId || null,
        homepage: discoverUrl('assistant', agent.identifier),
        identifier: agent.identifier,
        installCount: agent.installCount,
        isValidated: agent.isValidated,
        knowledgeCount: agent.knowledgeCount || 0,
        pluginCount: agent.pluginCount || 0,
        schemaVersion: 1,
        status: agent.status,
        tags: agent.tags || [],
        title: agent.name || agent.identifier,
        tokenUsage: agent.tokenUsage || 0,
      }),
    );

    // Transform favoriteAgentGroups to DiscoverGroupAgentItem format
    const transformedFavoriteAgentGroups = (favoriteAgentGroups || []).map((group: any) => ({
      author: group.author || '',
      avatar: group.avatar || '👥',
      category: group.category as any,
      createdAt: group.createdAt,
      description: group.description || '',
      forkCount: group.forkCount || 0,
      forkedFromGroupId: group.forkedFromGroupId || null,
      homepage: discoverUrl('group_agent', group.identifier),
      identifier: group.identifier,
      installCount: group.installCount || 0,
      isFeatured: group.isFeatured || false,
      isOfficial: group.isOfficial || false,
      isValidated: group.isValidated,
      memberCount: 0, // Will be populated from memberAgents in detail view
      schemaVersion: 1,
      status: group.status,
      tags: group.tags || [],
      title: group.name || group.identifier,
      updatedAt: group.updatedAt,
    }));

    // Transform skills to DiscoverSkillItem format
    const transformedSkills: DiscoverSkillItem[] = (skills || []).map((skill: any) => ({
      author: skill.author || '',
      category: skill.category,
      commentCount: skill.commentCount,
      createdAt: skill.createdAt,
      description: skill.description || '',
      github: skill.github,
      homepage: skill.homepage,
      icon: skill.icon,
      identifier: skill.identifier,
      installCount: skill.installCount || 0,
      isFeatured: skill.isFeatured || false,
      isOfficial: skill.isOfficial || false,
      isValidated: skill.isValidated || false,
      name: skill.name || skill.identifier,
      ratingAvg: skill.ratingAvg,
      ratingCount: skill.ratingCount || 0,
      resourcesCount: skill.resourcesCount,
      status: skill.status,
      tags: skill.tags || [],
      updatedAt: skill.updatedAt,
      version: skill.version || 'latest',
    }));

    // Transform plugins to DiscoverPluginItem format
    const transformedPlugins: DiscoverPluginItem[] = (plugins || []).map((plugin: any) => ({
      author: plugin.author || '',
      avatar: plugin.avatar,
      category: plugin.category,
      createdAt: plugin.createdAt,
      description: plugin.description || '',
      homepage: discoverUrl('plugin', plugin.identifier),
      identifier: plugin.identifier,
      installCount: plugin.installCount || 0,
      isClaimed: plugin.isClaimed || false,
      isFeatured: plugin.isFeatured || false,
      isOfficial: plugin.isOfficial || false,
      isValidated: plugin.isValidated || false,
      manifest: plugin.manifest || '',
      schemaVersion: 1,
      status: plugin.status,
      tags: plugin.tags || [],
      title: plugin.name || plugin.identifier,
      updatedAt: plugin.updatedAt,
    }));

    const result: DiscoverUserProfile = {
      agentGroups: transformedAgentGroups,
      agents: transformedAgents,
      favoriteAgentGroups: transformedFavoriteAgentGroups,
      favoriteAgents: transformedFavoriteAgents,
      forkedAgentGroups: transformedForkedAgentGroups,
      forkedAgents: transformedForkedAgents,
      plugins: transformedPlugins,
      skills: transformedSkills,
      user: {
        avatarUrl: user.avatarUrl || null,
        bannerUrl: user.meta?.bannerUrl || null,
        createdAt: user.createdAt,
        description: user.meta?.description || null,
        displayName: user.displayName || null,
        followersCount: user.followerCount ?? 0,
        followingCount: user.followingCount ?? 0,
        id: user.id,
        namespace: user.namespace,
        socialLinks: user.meta?.socialLinks || null,
        type: user.type || null,
        userName: user.userName || null,
      },
    };

    log(
      'getUserInfo: returning user profile with %d agents, %d groups, %d forked agents, %d forked groups, %d favorite agents, %d favorite groups, %d skills, %d plugins',
      result.agents.length,
      result.agentGroups?.length || 0,
      result.forkedAgents?.length || 0,
      result.forkedAgentGroups?.length || 0,
      result.favoriteAgents?.length || 0,
      result.favoriteAgentGroups?.length || 0,
      result.skills?.length || 0,
      result.plugins?.length || 0,
    );
    return result;
  } catch (error) {
    log('getUserInfo: error fetching user info: %O', error);
    if (!isMarketNotFound(error)) throw error;
  }
};
