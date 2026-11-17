import { API_KEY_FULL_ACCESS_SCOPE } from '@lobechat/const';
import { Hono } from 'hono';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { CollaboratorController } from '../controllers/collaborator.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import {
  AddCollaboratorsRequestSchema,
  AddedCollaboratorsSchema,
  CollaboratorListQuerySchema,
  CollaboratorListResponseSchema,
  CollaboratorParamSchema,
  CollaboratorResourceParamSchema,
  GeneralAccessSchema,
  SetGeneralAccessRequestSchema,
} from '../types/collaborator.type';
import { DeletedResourceSchema } from '../types/common.type';

/**
 * Collaborator routes, mounted at `/api/v1/{resourceType}/{resourceId}/collaborators`.
 *
 * `resourceType` is a whitelist (`agents`, `agent-groups`, `documents`,
 * `knowledge-bases` — see `COLLABORATOR_RESOURCES`); anything else fails
 * validation with 400. The SDK groups them as `collaborators.*`.
 *
 * Permissions exist only inside a team workspace: send `X-Workspace-Id` (or
 * use a workspace-bound key). Managing them is the resource creator's or a
 * workspace owner's call, enforced by the shared `resourcePermission` router.
 *
 * API key scopes: a full-access key for every route. Who can reach a resource
 * (with their emails) and granting or revoking that access is privilege
 * management, which a restricted key never reaches — the tRPC surface blocks
 * `resourcePermission` for restricted keys the same way.
 */
const CollaboratorRoutes = new Hono();

const fullAccess = requireApiKeyScope(API_KEY_FULL_ACCESS_SCOPE);
const tags = ['collaborators'];

/** GET /api/v1/:resourceType/:resourceId/collaborators */
CollaboratorRoutes.get(
  '/',
  routeDoc({
    data: CollaboratorListResponseSchema,
    description:
      'Members explicitly granted access to the resource. Creator or workspace owner only.',
    errors: [404],
    operationId: 'collaborators.list',
    summary: 'List collaborators of a resource',
    tags,
  }),
  requireAuth,
  fullAccess,
  zValidator('param', CollaboratorResourceParamSchema),
  zValidator('query', CollaboratorListQuerySchema),
  async (c) => new CollaboratorController().listCollaborators(c),
);

/** POST /api/v1/:resourceType/:resourceId/collaborators */
CollaboratorRoutes.post(
  '/',
  routeDoc({
    data: AddedCollaboratorsSchema,
    description:
      'Grants workspace members an access level on the resource; re-adding someone changes their level. Every user must be an active member of the workspace.',
    errors: [404],
    operationId: 'collaborators.add',
    requestExample: example(AddCollaboratorsRequestSchema, {
      accessLevel: 'view',
      userIds: ['user_teammate'],
    }),
    summary: 'Add collaborators to a resource',
    tags,
  }),
  requireAuth,
  fullAccess,
  zValidator('param', CollaboratorResourceParamSchema),
  zValidator('json', AddCollaboratorsRequestSchema),
  async (c) => new CollaboratorController().addCollaborators(c),
);

/** GET /api/v1/:resourceType/:resourceId/collaborators/general-access */
CollaboratorRoutes.get(
  '/general-access',
  routeDoc({
    data: GeneralAccessSchema,
    description:
      'What every workspace member gets on the resource, and whether the caller may change it.',
    errors: [404],
    operationId: 'collaborators.getGeneralAccess',
    summary: 'Get the general access of a resource',
    tags,
  }),
  requireAuth,
  fullAccess,
  zValidator('param', CollaboratorResourceParamSchema),
  async (c) => new CollaboratorController().getGeneralAccess(c),
);

/** PUT /api/v1/:resourceType/:resourceId/collaborators/general-access */
CollaboratorRoutes.put(
  '/general-access',
  routeDoc({
    data: GeneralAccessSchema,
    description:
      'Sets the access level every workspace member gets on the resource. Creator or workspace owner only.',
    errors: [404],
    operationId: 'collaborators.setGeneralAccess',
    requestExample: example(SetGeneralAccessRequestSchema, { accessLevel: 'view' }),
    summary: 'Set the general access of a resource',
    tags,
  }),
  requireAuth,
  fullAccess,
  zValidator('param', CollaboratorResourceParamSchema),
  zValidator('json', SetGeneralAccessRequestSchema),
  async (c) => new CollaboratorController().setGeneralAccess(c),
);

/** DELETE /api/v1/:resourceType/:resourceId/collaborators/:userId */
CollaboratorRoutes.delete(
  '/:userId',
  routeDoc({
    data: DeletedResourceSchema,
    description: "Revokes one member's explicit grant on the resource.",
    errors: [404],
    operationId: 'collaborators.remove',
    summary: 'Remove a collaborator from a resource',
    tags,
  }),
  requireAuth,
  fullAccess,
  zValidator('param', CollaboratorParamSchema),
  async (c) => new CollaboratorController().removeCollaborator(c),
);

export default CollaboratorRoutes;
