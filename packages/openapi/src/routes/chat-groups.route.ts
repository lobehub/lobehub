import { Hono } from 'hono';

import { getAllScopePermissions, getScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { ChatGroupController } from '../controllers/chat-group.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  BatchCreateChatGroupAgentsRequestSchema,
  ChatGroupIdParamSchema,
  ChatGroupListQuerySchema,
  ChatGroupListSchema,
  ChatGroupMemberParamSchema,
  ChatGroupMembersRequestSchema,
  ChatGroupSchema,
  CreateChatGroupRequestSchema,
  CreatedChatGroupAgentsSchema,
  DuplicateChatGroupRequestSchema,
  UpdateChatGroupMemberRequestSchema,
  UpdateChatGroupRequestSchema,
} from '../types/chat-group.type';
import { DeletedResourceSchema } from '../types/common.type';

// Multi-agent chat groups (`chat_groups`). Not to be confused with
// `agent-groups`, which are the sidebar folders.
const ChatGroupRoutes = new Hono();

const chatGroupWrite = requireAnyPermission(
  getAllScopePermissions('AGENT_UPDATE'),
  'You do not have permission to update chat groups',
);

ChatGroupRoutes.get(
  '/',
  routeDoc({ data: ChatGroupListSchema, summary: 'List chat groups', tags: ['chat-groups'] }),
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
  routeDoc({
    data: ChatGroupSchema,
    errors: [404, 409],
    status: 201,
    summary: 'Create a chat group with its supervisor and members',
    tags: ['chat-groups'],
  }),
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
  routeDoc({
    data: ChatGroupSchema,
    errors: [404],
    summary: 'Get a chat group',
    tags: ['chat-groups'],
  }),
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
  routeDoc({
    data: ChatGroupSchema,
    errors: [404, 409],
    summary: 'Update a chat group',
    tags: ['chat-groups'],
  }),
  requireAuth,
  chatGroupWrite,
  zValidator('param', ChatGroupIdParamSchema),
  zValidator('json', UpdateChatGroupRequestSchema),
  async (c) => new ChatGroupController().updateChatGroup(c),
);

ChatGroupRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    errors: [404],
    summary: 'Delete a chat group',
    tags: ['chat-groups'],
  }),
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
  routeDoc({
    operationId: 'chatGroups.addMembers',
    data: ChatGroupSchema,
    errors: [404],
    summary: 'Add members to a chat group',
    tags: ['chat-groups'],
  }),
  requireAuth,
  chatGroupWrite,
  zValidator('param', ChatGroupIdParamSchema),
  zValidator('json', ChatGroupMembersRequestSchema),
  async (c) => new ChatGroupController().addMembers(c),
);

ChatGroupRoutes.delete(
  '/:id/members',
  routeDoc({
    operationId: 'chatGroups.removeMembers',
    data: ChatGroupSchema,
    description: 'Detaches the agents and answers with the updated group.',
    errors: [404, 409],
    summary: 'Remove members from a chat group',
    tags: ['chat-groups'],
  }),
  requireAuth,
  chatGroupWrite,
  zValidator('param', ChatGroupIdParamSchema),
  zValidator('json', ChatGroupMembersRequestSchema),
  async (c) => new ChatGroupController().removeMembers(c),
);

// ---------------------------------------------------------------------------
// Advanced group operations, run through the shared `agentGroup` procedures
// (duplicateGroup / batchCreateAgentsInGroup / updateAgentInGroup).
// ---------------------------------------------------------------------------
const GROUP_SCOPE_NOTE =
  'Resolved in the workspace named by `X-Workspace-Id` (or the personal space without it); a group outside that scope answers 404. Needs edit access to the group in a workspace.';

ChatGroupRoutes.post(
  '/:id/duplicate',
  routeDoc({
    data: ChatGroupSchema,
    description: `Copy the group with its configuration and a new supervisor. Members the group owns (created inside it) are copied; agents it only references are referenced again, not copied. ${GROUP_SCOPE_NOTE}`,
    errors: [404],
    operationId: 'chatGroups.duplicate',
    status: 201,
    summary: 'Duplicate a chat group',
    tags: ['chat-groups'],
  }),
  requireAuth,
  chatGroupWrite,
  zValidator('param', ChatGroupIdParamSchema),
  zValidator('json', DuplicateChatGroupRequestSchema),
  async (c) => new ChatGroupController().duplicateChatGroup(c),
);

ChatGroupRoutes.post(
  '/:id/agents',
  routeDoc({
    data: CreatedChatGroupAgentsSchema,
    description: `Create several member agents inside the group in one call. They belong to the group (virtual agents) and inherit its workspace access level; they do not appear in the agent list on their own. ${GROUP_SCOPE_NOTE}`,
    errors: [404],
    operationId: 'chatGroups.createAgents',
    status: 201,
    summary: 'Create member agents in a chat group',
    tags: ['chat-groups'],
  }),
  requireAuth,
  chatGroupWrite,
  zValidator('param', ChatGroupIdParamSchema),
  zValidator('json', BatchCreateChatGroupAgentsRequestSchema),
  async (c) => new ChatGroupController().batchCreateAgents(c),
);

ChatGroupRoutes.patch(
  '/:id/members/:agentId',
  routeDoc({
    data: ChatGroupSchema,
    description: `Enable or disable one member, change its speaking \`order\`, or switch it between \`participant\` and \`assistant\`. The supervisor's role cannot change. ${GROUP_SCOPE_NOTE}`,
    errors: [404],
    operationId: 'chatGroups.updateMember',
    summary: 'Update a chat group member',
    tags: ['chat-groups'],
  }),
  requireAuth,
  chatGroupWrite,
  zValidator('param', ChatGroupMemberParamSchema),
  zValidator('json', UpdateChatGroupMemberRequestSchema),
  async (c) => new ChatGroupController().updateMember(c),
);

export default ChatGroupRoutes;
