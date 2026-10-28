import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ChatGroupService } from '../services/chat-group.service';
import type {
  ChatGroupMembersRequest,
  CreateChatGroupRequest,
  GetChatGroupsRequest,
  UpdateChatGroupRequest,
} from '../types/chat-group.type';

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
      return this.success(c, await service.listChatGroups(request), 'Chat groups retrieved');
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
      return this.success(c, null, 'Chat group deleted');
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
}
