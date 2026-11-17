import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { AgentLabelController } from '../controllers/agent-label.controller';
import { CursorPaginationQuerySchema } from '../helpers/pagination';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  AgentLabelIdParamSchema,
  AgentLabelListSchema,
  AgentLabelSchema,
  CreateAgentLabelRequestSchema,
  UpdateAgentLabelRequestSchema,
} from '../types/agent-label.type';
import { DeletedResourceSchema } from '../types/common.type';

/**
 * Agent labels — the registry of tags agents are filed under. In a workspace
 * the registry is shared by every member (`X-Workspace-Id`); without it, it is
 * the caller's personal set. The rules live in the shared `agentLabel`
 * procedures; see `AgentLabelRestService`.
 */
const AgentLabelRoutes = new Hono();

const SCOPE_NOTE =
  'Scoped to the workspace named by `X-Workspace-Id` (shared by all its members) or to the personal space without it; a label outside that scope answers 404.';

AgentLabelRoutes.get(
  '/',
  routeDoc({
    data: AgentLabelListSchema,
    description: `Labels sorted by name, archived ones included. \`usageCount\` counts only agents the caller can see. ${SCOPE_NOTE}`,
    summary: 'List agent labels',
    tags: ['agent-labels'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_LABEL_READ'),
    'You do not have permission to view agent labels',
  ),
  zValidator('query', CursorPaginationQuerySchema),
  async (c) => new AgentLabelController().listLabels(c),
);

AgentLabelRoutes.post(
  '/',
  routeDoc({
    data: AgentLabelSchema,
    description: `Create a label. Names are unique among active labels in the scope (409 on a clash); \`color\` must be a hex literal. ${SCOPE_NOTE}`,
    errors: [409],
    status: 201,
    summary: 'Create an agent label',
    tags: ['agent-labels'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_LABEL_CREATE'),
    'You do not have permission to create agent labels',
  ),
  zValidator('json', CreateAgentLabelRequestSchema),
  async (c) => new AgentLabelController().createLabel(c),
);

AgentLabelRoutes.get(
  '/:id',
  routeDoc({
    data: AgentLabelSchema,
    description: `One label with its usage count. ${SCOPE_NOTE}`,
    errors: [404],
    summary: 'Get an agent label',
    tags: ['agent-labels'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_LABEL_READ'),
    'You do not have permission to view agent labels',
  ),
  zValidator('param', AgentLabelIdParamSchema),
  async (c) => new AgentLabelController().getLabel(c),
);

AgentLabelRoutes.patch(
  '/:id',
  routeDoc({
    data: AgentLabelSchema,
    description: `Rename, recolour, describe or archive a label. Archived labels stay on the agents carrying them but cannot be newly assigned. Renaming (or un-archiving) into a name already in use answers 409. ${SCOPE_NOTE}`,
    errors: [404, 409],
    summary: 'Update an agent label',
    tags: ['agent-labels'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_LABEL_UPDATE'),
    'You do not have permission to update agent labels',
  ),
  zValidator('param', AgentLabelIdParamSchema),
  zValidator('json', UpdateAgentLabelRequestSchema),
  async (c) => new AgentLabelController().updateLabel(c),
);

AgentLabelRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    description: `Delete a label and remove it from every agent carrying it. ${SCOPE_NOTE}`,
    errors: [404],
    summary: 'Delete an agent label',
    tags: ['agent-labels'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_LABEL_DELETE'),
    'You do not have permission to delete agent labels',
  ),
  zValidator('param', AgentLabelIdParamSchema),
  async (c) => new AgentLabelController().deleteLabel(c),
);

export default AgentLabelRoutes;
