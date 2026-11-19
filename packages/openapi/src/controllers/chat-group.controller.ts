import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ChatGroupService } from '../services/chat-group.service';
import type {
  BatchCreateChatGroupAgentsRequest,
  ChatGroupMembersRequest,
  CreateChatGroupRequest,
  DuplicateChatGroupRequest,
  GetChatGroupsRequest,
  UpdateChatGroupMemberRequest,
  UpdateChatGroupRequest,
} from '../types/chat-group.type';
import type { DeletedResource } from '../types/common.type';

export class ChatGroupController extends BaseController {
  private async getService(c: Context) {
    return new ChatGroupService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
      c.get('workspaceRole'),
    );
  }

  async listChatGroups(c: Context): Promise<Response> {
    try {
      const request = this.getQuery<GetChatGroupsRequest>(c);
      const service = await this.getService(c);
      return this.list(c, 'chatGroups', await service.listChatGroups(request), {
        message: 'Chat groups retrieved',
        pagination: request,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async getChatGroup(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = await this.getService(c);
      return this.success(c, await service.getChatGroup(id), 'Chat group retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async createChatGroup(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateChatGroupRequest>(c);
      const service = await this.getService(c);
      return this.success(c, await service.createChatGroup(body), 'Chat group created', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async updateChatGroup(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<UpdateChatGroupRequest>(c);
      const service = await this.getService(c);
      return this.success(c, await service.updateChatGroup(id, body), 'Chat group updated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async deleteChatGroup(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = await this.getService(c);
      await service.deleteChatGroup(id);
      return this.success(c, { deleted: true, id } satisfies DeletedResource, 'Chat group deleted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async addMembers(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const { agentIds } = await this.getBody<ChatGroupMembersRequest>(c);
      const service = await this.getService(c);
      return this.success(c, await service.addMembers(id, agentIds), 'Chat group members added');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async removeMembers(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const { agentIds } = await this.getBody<ChatGroupMembersRequest>(c);
      const service = await this.getService(c);
      return this.success(
        c,
        await service.removeMembers(id, agentIds),
        'Chat group members removed',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/chat-groups/:id/duplicate */
  async duplicateChatGroup(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<DuplicateChatGroupRequest>(c);
      const service = await this.getService(c);
      return this.success(
        c,
        await service.duplicateChatGroup(id, body),
        'Chat group duplicated',
        201,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/chat-groups/:id/agents */
  async batchCreateAgents(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<BatchCreateChatGroupAgentsRequest>(c);
      const service = await this.getService(c);
      return this.success(
        c,
        await service.batchCreateAgents(id, body),
        'Chat group agents created',
        201,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PATCH /api/v1/chat-groups/:id/members/:agentId */
  async updateMember(c: Context): Promise<Response> {
    try {
      const { agentId, id } = this.getParams<{ agentId: string; id: string }>(c);
      const body = await this.getBody<UpdateChatGroupMemberRequest>(c);
      const service = await this.getService(c);
      return this.success(
        c,
        await service.updateMember(id, agentId, body),
        'Chat group member updated',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
