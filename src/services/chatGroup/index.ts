import { type AgentGroupDetail, type AgentItem } from '@lobechat/types';

import {
  type ChatGroupAgentItem,
  type ChatGroupItem,
  type NewChatGroup,
  type NewChatGroupAgent,
} from '@/database/schemas';
import { lambdaClient } from '@/libs/trpc/client';

export interface GroupMemberConfig {
  avatar?: string;
  backgroundColor?: string;
  description?: string;
  model?: string;
  plugins?: string[];
  provider?: string;
  systemRole?: string;
  tags?: string[];
  title?: string;
}

class ChatGroupService {
  /**
   * Create a group with a supervisor agent.
   * The supervisor agent is automatically created as a virtual agent.
   */
  createGroup = (
    params: Omit<NewChatGroup, 'userId'>,
  ): Promise<{ group: ChatGroupItem; supervisorAgentId: string }> => {
    return lambdaClient.group.createGroup.mutate({
      ...params,
      config: params.config as any,
    });
  };

  /**
   * Create a group with virtual member agents in one request.
   * This is the recommended way to create a group from a template.
   * Returns groupId, supervisorAgentId, and member agentIds.
   */
  createGroupWithMembers = (
    groupConfig: Omit<NewChatGroup, 'userId'>,
    members: GroupMemberConfig[],
  ): Promise<{ agentIds: string[]; groupId: string; supervisorAgentId: string }> => {
    return lambdaClient.group.createGroupWithMembers.mutate({
      groupConfig: {
        ...groupConfig,
        config: groupConfig.config as any,
      },
      members: members as Partial<AgentItem>[],
    });
  };

  updateGroup = (id: string, value: Partial<ChatGroupItem>): Promise<ChatGroupItem> => {
    return lambdaClient.group.updateGroup.mutate({
      id,
      value: {
        ...value,
        config: value.config as any,
      },
    });
  };

  deleteGroup = (id: string) => {
    return lambdaClient.group.deleteGroup.mutate({ id });
  };

  getGroup = (id: string): Promise<ChatGroupItem | undefined> => {
    return lambdaClient.group.getGroup.query({ id });
  };

  getGroupDetail = (id: string): Promise<AgentGroupDetail | null> => {
    return lambdaClient.group.getGroupDetail.query({ id });
  };

  getGroups = (): Promise<ChatGroupItem[]> => {
    return lambdaClient.group.getGroups.query();
  };

  addAgentsToGroup = (
    groupId: string,
    agentIds: string[],
  ): Promise<{ added: NewChatGroupAgent[]; existing: string[] }> => {
    return lambdaClient.group.addAgentsToGroup.mutate({ agentIds, groupId });
  };

  /**
   * Batch create virtual agents and add them to an existing group.
   * This is more efficient than calling createAgentOnly multiple times.
   */
  batchCreateAgentsInGroup = (groupId: string, agents: GroupMemberConfig[]) => {
    return lambdaClient.group.batchCreateAgentsInGroup.mutate({
      agents: agents as Partial<AgentItem>[],
      groupId,
    });
  };

  removeAgentsFromGroup = (groupId: string, agentIds: string[]) => {
    return lambdaClient.group.removeAgentsFromGroup.mutate({ agentIds, groupId });
  };

  updateAgentInGroup = (
    groupId: string,
    agentId: string,
    updates: Partial<Pick<NewChatGroupAgent, 'order' | 'role'>>,
  ): Promise<NewChatGroupAgent> => {
    return lambdaClient.group.updateAgentInGroup.mutate({
      agentId,
      groupId,
      updates: {
        order: updates.order === null ? undefined : updates.order,
        role: updates.role === null ? undefined : updates.role,
      },
    });
  };

  getGroupAgents = (groupId: string): Promise<ChatGroupAgentItem[]> => {
    return lambdaClient.group.getGroupAgents.query({ groupId });
  };

  /**
   * Duplicate a chat group with all its members.
   * Returns the new group ID and supervisor agent ID.
   */
  duplicateGroup = (
    groupId: string,
    newTitle?: string,
  ): Promise<{ groupId: string; supervisorAgentId: string } | null> => {
    return lambdaClient.group.duplicateGroup.mutate({ groupId, newTitle });
  };
}

export const chatGroupService = new ChatGroupService();
