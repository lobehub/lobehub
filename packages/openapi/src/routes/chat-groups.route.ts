import { Hono } from 'hono';

import { getAllScopePermissions, getScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { ChatGroupController } from '../controllers/chat-group.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  ChatGroupIdParamSchema,
  ChatGroupListQuerySchema,
  ChatGroupMembersRequestSchema,
  CreateChatGroupRequestSchema,
  UpdateChatGroupRequestSchema,
} from '../types/chat-group.type';

// Multi-agent chat groups (`chat_groups`). Not to be confused with
// `agent-groups`, which are the sidebar folders.
const ChatGroupRoutes = new Hono();

const chatGroupWrite = requireAnyPermission(
  getAllScopePermissions('AGENT_UPDATE'),
  'You do not have permission to update chat groups',
);

ChatGroupRoutes.get(
  '/',
  requireAuth,
  requireAnyPermission(
    getScopePermissions('AGENT_READ', ['ALL', 'OWNER']),
    'You do not have permission to view chat groups',
  ),
  zValidator('query', ChatGroupListQuerySchema),
  async (c) => new ChatGroupController().listChatGroups(c),
);

ChatGroupRoutes.post(
  '/',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_CREATE'),
    'You do not have permission to create chat groups',
  ),
  zValidator('json', CreateChatGroupRequestSchema),
  async (c) => new ChatGroupController().createChatGroup(c),
);

ChatGroupRoutes.get(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_READ'),
    'You do not have permission to view chat groups',
  ),
  zValidator('param', ChatGroupIdParamSchema),
  async (c) => new ChatGroupController().getChatGroup(c),
);

ChatGroupRoutes.patch(
  '/:id',
  requireAuth,
  chatGroupWrite,
  zValidator('param', ChatGroupIdParamSchema),
  zValidator('json', UpdateChatGroupRequestSchema),
  async (c) => new ChatGroupController().updateChatGroup(c),
);

ChatGroupRoutes.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_DELETE'),
    'You do not have permission to delete chat groups',
  ),
  zValidator('param', ChatGroupIdParamSchema),
  async (c) => new ChatGroupController().deleteChatGroup(c),
);

ChatGroupRoutes.post(
  '/:id/members',
  requireAuth,
  chatGroupWrite,
  zValidator('param', ChatGroupIdParamSchema),
  zValidator('json', ChatGroupMembersRequestSchema),
  async (c) => new ChatGroupController().addMembers(c),
);

ChatGroupRoutes.delete(
  '/:id/members',
  requireAuth,
  chatGroupWrite,
  zValidator('param', ChatGroupIdParamSchema),
  zValidator('json', ChatGroupMembersRequestSchema),
  async (c) => new ChatGroupController().removeMembers(c),
);

export default ChatGroupRoutes;
