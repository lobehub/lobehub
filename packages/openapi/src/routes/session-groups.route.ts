import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { SessionGroupController } from '../controllers/session-group.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  CreateSessionGroupRequestSchema,
  MoveAgentsToSessionGroupRequestSchema,
  ReorderedSessionGroupsSchema,
  ReorderSessionGroupsRequestSchema,
  SessionGroupAgentMoveSchema,
  SessionGroupIdParamSchema,
  SessionGroupListQuerySchema,
  SessionGroupListSchema,
  SessionGroupSchema,
  UpdateSessionGroupRequestSchema,
} from '../types/session-group.type';

/**
 * Session groups — the sidebar folders agents and chat groups are filed
 * under. Folders organise agents, so a restricted key reaches them with the
 * agent scopes (as `/agent-groups`, the older name for the same rows, does);
 * the issuer still needs the `session_group:*` permission. The rules live in
 * the shared `sessionGroup` procedures; see `SessionGroupRestService`.
 */
const SessionGroupRoutes = new Hono();

const SCOPE_NOTE =
  'Scoped to the workspace named by `X-Workspace-Id` (private folders are visible to their creator only) or to the personal space without it; a folder outside that scope answers 404.';

const read = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('SESSION_GROUP_READ'),
  'agent:read',
  'You do not have permission to view session groups',
);
const create = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('SESSION_GROUP_CREATE'),
  'agent:write',
  'You do not have permission to create session groups',
);
const update = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('SESSION_GROUP_UPDATE'),
  'agent:write',
  'You do not have permission to update session groups',
);
const remove = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('SESSION_GROUP_DELETE'),
  'agent:write',
  'You do not have permission to delete session groups',
);
const moveAgent = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AGENT_UPDATE'),
  'agent:write',
  'You do not have permission to move agents between session groups',
);

SessionGroupRoutes.get(
  '/',
  routeDoc({
    data: SessionGroupListSchema,
    description: `Folders in sidebar order (\`sort\` ascending, then newest first). ${SCOPE_NOTE}`,
    summary: 'List session groups',
    tags: ['session-groups'],
  }),
  requireAuth,
  read,
  zValidator('query', SessionGroupListQuerySchema),
  async (c) => new SessionGroupController().listGroups(c),
);

SessionGroupRoutes.post(
  '/',
  routeDoc({
    data: SessionGroupSchema,
    description: `Create a folder. In a workspace it is shared with every member unless \`visibility: private\`. ${SCOPE_NOTE}`,
    status: 201,
    summary: 'Create a session group',
    tags: ['session-groups'],
  }),
  requireAuth,
  create,
  zValidator('json', CreateSessionGroupRequestSchema),
  async (c) => new SessionGroupController().createGroup(c),
);

SessionGroupRoutes.post(
  '/reorder',
  routeDoc({
    data: ReorderedSessionGroupsSchema,
    description: `Set the \`sort\` of several folders in one transaction, e.g. after a drag-and-drop. Every id must be a folder in scope, otherwise 404 and nothing changes. ${SCOPE_NOTE}`,
    errors: [404],
    operationId: 'sessionGroups.reorder',
    summary: 'Reorder session groups',
    tags: ['session-groups'],
  }),
  requireAuth,
  update,
  zValidator('json', ReorderSessionGroupsRequestSchema),
  async (c) => new SessionGroupController().reorderGroups(c),
);

SessionGroupRoutes.post(
  '/move-agents',
  routeDoc({
    data: SessionGroupAgentMoveSchema,
    description: `File agents under a folder, or take them out of any folder with \`sessionGroupId: null\`. In a workspace an agent only moves into a folder of the same visibility (a private agent into a private folder). Every agent and the folder must be in scope, otherwise 404. ${SCOPE_NOTE}`,
    errors: [404],
    operationId: 'sessionGroups.moveAgents',
    summary: 'Move agents into or out of a session group',
    tags: ['session-groups'],
  }),
  requireAuth,
  moveAgent,
  zValidator('json', MoveAgentsToSessionGroupRequestSchema),
  async (c) => new SessionGroupController().moveAgents(c),
);

SessionGroupRoutes.get(
  '/:id',
  routeDoc({
    data: SessionGroupSchema,
    description: `One folder. ${SCOPE_NOTE}`,
    errors: [404],
    summary: 'Get a session group',
    tags: ['session-groups'],
  }),
  requireAuth,
  read,
  zValidator('param', SessionGroupIdParamSchema),
  async (c) => new SessionGroupController().getGroup(c),
);

SessionGroupRoutes.patch(
  '/:id',
  routeDoc({
    data: SessionGroupSchema,
    description: `Rename or re-sort a folder, or publish a private one with \`visibility: public\` (one-way; refused while it still holds private items). ${SCOPE_NOTE}`,
    errors: [404],
    summary: 'Update a session group',
    tags: ['session-groups'],
  }),
  requireAuth,
  update,
  zValidator('param', SessionGroupIdParamSchema),
  zValidator('json', UpdateSessionGroupRequestSchema),
  async (c) => new SessionGroupController().updateGroup(c),
);

SessionGroupRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    description: `Delete a folder. The agents and chat groups in it are kept and become ungrouped. ${SCOPE_NOTE}`,
    errors: [404],
    summary: 'Delete a session group',
    tags: ['session-groups'],
  }),
  requireAuth,
  remove,
  zValidator('param', SessionGroupIdParamSchema),
  async (c) => new SessionGroupController().deleteGroup(c),
);

export default SessionGroupRoutes;
