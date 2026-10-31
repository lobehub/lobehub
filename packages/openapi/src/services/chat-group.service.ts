import { TRPCError } from '@trpc/server';

import { AGENT_COPY_IN_PROGRESS } from '@/database/models/agentCopyJob';
import { AGENT_TRANSFER_IN_PROGRESS } from '@/database/models/agentTransferJob';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { ResourceTransferRequestModel } from '@/database/models/resourceTransferRequest';
import { AgentGroupRepository } from '@/database/repositories/agentGroup';
import type { ChatGroupAgentItem, ChatGroupItem } from '@/database/schemas';
import { DEFAULT_RESOURCE_ACCESS_LEVELS } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { isWorkspaceNonOwner } from '@/server/routers/lambda/_helpers/assertWorkspaceRowManageable';
import { getResourceConfigAccess } from '@/server/routers/lambda/_helpers/resourceConfigGuard';
import { EditLockService } from '@/server/services/editLock';
import {
  assertCanEditResource,
  assertCanPerformResourceAction,
} from '@/server/services/resourcePermission';

import { BaseService } from '../common/base.service';
import { processPaginationConditions } from '../helpers/pagination';
import { projectPublicChatGroup, type PublicChatGroup } from '../helpers/public-fields';
import type { ServiceResult } from '../types';
import type {
  ChatGroupListResponse,
  CreateChatGroupRequest,
  GetChatGroupsRequest,
  UpdateChatGroupRequest,
} from '../types/chat-group.type';

const CONFIG_ACCESS_LOOKUP_CONCURRENCY = 5;

const groupMembersById = (members: ChatGroupAgentItem[]) => {
  const map = new Map<string, ChatGroupAgentItem[]>();
  for (const member of members) {
    const list = map.get(member.chatGroupId) ?? [];
    list.push(member);
    map.set(member.chatGroupId, list);
  }
  return map;
};

export class ChatGroupService extends BaseService {
  private agentGroupRepo: AgentGroupRepository;
  private chatGroupModel: ChatGroupModel;
  private workspaceRole?: string;

  constructor(
    db: LobeChatDatabase,
    userId: string | null,
    workspaceId?: string,
    workspaceRole?: string,
  ) {
    super(db, userId, workspaceId);
    this.workspaceRole = workspaceRole;
    this.agentGroupRepo = new AgentGroupRepository(db, this.userId, workspaceId);
    this.chatGroupModel = new ChatGroupModel(db, this.userId, workspaceId);
  }

  async listChatGroups(request: GetChatGroupsRequest): ServiceResult<ChatGroupListResponse> {
    try {
      const groups = await this.chatGroupModel.query();
      const visibleGroups = (await this.filterViewableGroups(groups)).filter(
        (group) =>
          request.personal === undefined || (group.config?.personal === true) === request.personal,
      );
      const { limit = visibleGroups.length, offset = 0 } = processPaginationConditions(request);
      const page = visibleGroups.slice(offset, offset + limit);

      const members = groupMembersById(
        await this.chatGroupModel.getGroupAgentsByGroupIds(page.map((group) => group.id)),
      );

      return {
        chatGroups: page.map((group) => projectPublicChatGroup(group, members.get(group.id) ?? [])),
        total: visibleGroups.length,
      };
    } catch (error) {
      this.rethrow(error, 'list chat groups');
    }
  }

  async getChatGroup(id: string): ServiceResult<PublicChatGroup> {
    try {
      const group = await this.chatGroupModel.findById(id);
      if (!group || (await this.getConfigAccess(group)) === 'none') {
        throw this.createNotFoundError('Chat group not found');
      }

      const members = await this.chatGroupModel.getGroupAgents(id);
      return projectPublicChatGroup(group, members);
    } catch (error) {
      this.rethrow(error, 'get chat group');
    }
  }

  async createChatGroup(request: CreateChatGroupRequest): ServiceResult<PublicChatGroup> {
    try {
      const { group, supervisorAgentId } = await this.agentGroupRepo.createGroupWithSupervisor({
        avatar: request.avatar,
        backgroundColor: request.backgroundColor,
        clientId: request.clientId,
        config: request.personal ? { personal: true } : undefined,
        title: request.title,
      });

      try {
        const agentIds = [...new Set(request.members.map((member) => member.agentId))];
        await this.chatGroupModel.addAgentsToGroup(group.id, agentIds);

        for (const member of request.members) {
          if (member.role && member.role !== 'participant') {
            await this.chatGroupModel.updateAgentInGroup(group.id, member.agentId, {
              role: member.role,
            });
          }
        }
      } catch (error) {
        await this.agentGroupRepo.deleteGroup(group.id);
        throw error;
      }

      if (this.workspaceId && group.visibility !== 'private') {
        const permissionModel = new ResourcePermissionModel(this.db, this.workspaceId);
        await Promise.all([
          permissionModel.setAccessLevel(
            'agentGroup',
            group.id,
            DEFAULT_RESOURCE_ACCESS_LEVELS.agentGroup,
            this.userId,
          ),
          permissionModel.setAccessLevel(
            'agent',
            supervisorAgentId,
            DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
            this.userId,
          ),
        ]);
      }

      return await this.getChatGroup(group.id);
    } catch (error) {
      this.rethrow(error, 'create chat group');
    }
  }

  async updateChatGroup(
    id: string,
    request: UpdateChatGroupRequest,
  ): ServiceResult<PublicChatGroup> {
    try {
      const group = await this.assertGroupExists(id);
      await assertCanEditResource({
        db: this.db,
        resourceId: id,
        resourceType: 'agentGroup',
        userId: this.userId,
        workspaceId: this.workspaceId,
      });

      if (this.workspaceId) {
        const blockedBy = await new EditLockService(this.userId).getBlockingHolder('chatGroup', id);
        if (blockedBy) throw this.createConflictError('Group is being edited by another user');
      }

      const { personal, ...value } = request;
      await this.chatGroupModel.update(
        id,
        personal === undefined ? value : { ...value, config: { ...group.config, personal } },
      );
      return await this.getChatGroup(id);
    } catch (error) {
      this.rethrow(error, 'update chat group');
    }
  }

  async deleteChatGroup(id: string): ServiceResult<void> {
    try {
      await this.assertGroupExists(id);

      if (this.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'delete',
          db: this.db,
          resourceId: id,
          resourceType: 'agentGroup',
          userId: this.userId,
          workspaceId: this.workspaceId,
        });
        // Deleting cascades topics and messages, so a non-owner must not erase
        // teammates' conversations along with the group.
        if (
          isWorkspaceNonOwner({
            workspaceId: this.workspaceId,
            workspaceRole: this.workspaceRole,
          }) &&
          (await this.agentGroupRepo.transferHasForeignRows(id))
        ) {
          throw this.createAuthorizationError(
            "Only workspace owners can delete a group carrying others' conversations",
          );
        }
      }

      await this.agentGroupRepo.deleteGroup(id);

      if (this.workspaceId) {
        await new ResourcePermissionModel(this.db, this.workspaceId).removeAll('agentGroup', id);
        await new ResourceTransferRequestModel(this.db, this.workspaceId).invalidateForResources(
          'agentGroup',
          [id],
        );
      }
    } catch (error) {
      this.rethrow(error, 'delete chat group');
    }
  }

  async addMembers(id: string, agentIds: string[]): ServiceResult<PublicChatGroup> {
    try {
      await this.assertGroupExists(id);
      await this.assertCanEditMembers(id);

      await this.chatGroupModel.addAgentsToGroup(id, [...new Set(agentIds)]);
      return await this.getChatGroup(id);
    } catch (error) {
      this.rethrow(error, 'add chat group members');
    }
  }

  async removeMembers(id: string, agentIds: string[]): ServiceResult<PublicChatGroup> {
    try {
      await this.assertGroupExists(id);
      await this.assertCanEditMembers(id);

      const supervisorAgentId = await this.chatGroupModel.getSupervisorAgentId(id);
      if (supervisorAgentId && agentIds.includes(supervisorAgentId)) {
        throw this.createValidationError('The group supervisor cannot be removed');
      }

      try {
        await this.agentGroupRepo.removeAgentsFromGroup(id, [...new Set(agentIds)]);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === AGENT_TRANSFER_IN_PROGRESS || error.message === AGENT_COPY_IN_PROGRESS)
        ) {
          throw this.createConflictError(
            "A previous transfer or copy of this group's agents is still in progress",
          );
        }
        throw error;
      }

      return await this.getChatGroup(id);
    } catch (error) {
      this.rethrow(error, 'remove chat group members');
    }
  }

  // Model and permission helpers throw TRPCError; the controller maps those
  // codes to HTTP statuses, so they must not be flattened into a 400.
  private rethrow(error: unknown, operation: string): never {
    if (error instanceof TRPCError) throw error;
    const details = error as { code?: string; cause?: { code?: string } };
    if ((details?.code ?? details?.cause?.code) === '23505')
      throw this.createConflictError('A chat group with this clientId already exists');
    this.handleServiceError(error, operation);
  }

  private async assertGroupExists(id: string) {
    const group = await this.chatGroupModel.findById(id);
    if (!group) throw this.createNotFoundError('Chat group not found');
    return group;
  }

  private async assertCanEditMembers(id: string) {
    if (!this.workspaceId) return;
    await assertCanPerformResourceAction({
      action: 'edit',
      db: this.db,
      resourceId: id,
      resourceType: 'agentGroup',
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
  }

  private getConfigAccess(group: ChatGroupItem) {
    return getResourceConfigAccess(
      { db: this.db, userId: this.userId, workspaceId: this.workspaceId },
      'agentGroup',
      group.id,
      {
        userId: group.userId,
        visibility: group.visibility ?? null,
        workspaceId: group.workspaceId ?? null,
      },
    );
  }

  private async filterViewableGroups(groups: ChatGroupItem[]): Promise<ChatGroupItem[]> {
    if (!this.workspaceId) return groups;

    const visible: ChatGroupItem[] = [];
    for (let i = 0; i < groups.length; i += CONFIG_ACCESS_LOOKUP_CONCURRENCY) {
      const batch = groups.slice(i, i + CONFIG_ACCESS_LOOKUP_CONCURRENCY);
      const access = await Promise.all(batch.map((group) => this.getConfigAccess(group)));
      batch.forEach((group, index) => {
        if (access[index] !== 'none') visible.push(group);
      });
    }
    return visible;
  }
}
