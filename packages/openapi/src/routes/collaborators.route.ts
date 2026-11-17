import { API_KEY_FULL_ACCESS_SCOPE } from '@lobechat/const';
import { Hono } from 'hono';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { CollaboratorController } from '../controllers/collaborator.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import type { CollaboratorResourceSegment } from '../types/collaborator.type';
import {
  AddCollaboratorsRequestSchema,
  AddedCollaboratorsSchema,
  COLLABORATOR_RESOURCES,
  CollaboratorListQuerySchema,
  CollaboratorListResponseSchema,
  CollaboratorParamSchema,
  CollaboratorResourceParamSchema,
  GeneralAccessSchema,
  SetGeneralAccessRequestSchema,
} from '../types/collaborator.type';
import { DeletedResourceSchema } from '../types/common.type';

const LABELS: Record<CollaboratorResourceSegment, string> = {
  'agent-groups': 'agent group',
  'agents': 'agent',
  'documents': 'document',
  'knowledge-bases': 'knowledge base',
};

/**
 * Collaborator routes for one resource type, mounted at
 * `/api/v1/{segment}/{resourceId}/collaborators` for each whitelisted segment
 * in `COLLABORATOR_RESOURCES` (agents, agent groups, documents, knowledge
 * bases). Operation ids follow the segment, so the SDK reads
 * `agents.listCollaborators()`, `documents.setGeneralAccess()`.
 *
 * Permissions exist only inside a team workspace: send `X-Workspace-Id` (or
 * use a workspace-bound key). Managing them is the resource creator's or a
 * workspace owner's call, enforced by the shared `resourcePermission` router.
 *
 * API key scopes: reads need `workspace:read`. Granting or revoking access is
 * privilege management, which a restricted key never reaches (as on the tRPC
 * surface), so writes need a full-access key.
 */
export const createCollaboratorRoutes = (segment: CollaboratorResourceSegment) => {
  const routes = new Hono();
  const resourceType = COLLABORATOR_RESOURCES[segment];
  const label = LABELS[segment];
  const controller = () => new CollaboratorController(resourceType);
  const tags = ['collaborators'];
  const resource = segment.replaceAll(/-(\w)/g, (_, char: string) => char.toUpperCase());
  const op = (method: string) => `${resource}.${method}` as const;

  const read = requireApiKeyScope('workspace:read');
  const manage = requireApiKeyScope(API_KEY_FULL_ACCESS_SCOPE);

  routes.get(
    '/',
    routeDoc({
      data: CollaboratorListResponseSchema,
      description: `Members explicitly granted access to this ${label}. Creator or workspace owner only.`,
      errors: [404],
      operationId: op('listCollaborators'),
      summary: `List collaborators of a ${label}`,
      tags,
    }),
    requireAuth,
    read,
    zValidator('param', CollaboratorResourceParamSchema),
    zValidator('query', CollaboratorListQuerySchema),
    async (c) => controller().listCollaborators(c),
  );

  routes.post(
    '/',
    routeDoc({
      data: AddedCollaboratorsSchema,
      description: `Grants workspace members an access level on this ${label}; re-adding someone changes their level. Every user must be an active member of the workspace.`,
      errors: [404],
      operationId: op('addCollaborators'),
      requestExample: example(AddCollaboratorsRequestSchema, {
        accessLevel: 'view',
        userIds: ['user_teammate'],
      }),
      summary: `Add collaborators to a ${label}`,
      tags,
    }),
    requireAuth,
    manage,
    zValidator('param', CollaboratorResourceParamSchema),
    zValidator('json', AddCollaboratorsRequestSchema),
    async (c) => controller().addCollaborators(c),
  );

  routes.get(
    '/general-access',
    routeDoc({
      data: GeneralAccessSchema,
      description: `What every workspace member gets on this ${label}, and whether the caller may change it.`,
      errors: [404],
      operationId: op('getGeneralAccess'),
      summary: `Get the general access of a ${label}`,
      tags,
    }),
    requireAuth,
    read,
    zValidator('param', CollaboratorResourceParamSchema),
    async (c) => controller().getGeneralAccess(c),
  );

  routes.put(
    '/general-access',
    routeDoc({
      data: GeneralAccessSchema,
      description: `Sets the access level every workspace member gets on this ${label}. Creator or workspace owner only.`,
      errors: [404],
      operationId: op('setGeneralAccess'),
      requestExample: example(SetGeneralAccessRequestSchema, { accessLevel: 'view' }),
      summary: `Set the general access of a ${label}`,
      tags,
    }),
    requireAuth,
    manage,
    zValidator('param', CollaboratorResourceParamSchema),
    zValidator('json', SetGeneralAccessRequestSchema),
    async (c) => controller().setGeneralAccess(c),
  );

  routes.delete(
    '/:userId',
    routeDoc({
      data: DeletedResourceSchema,
      description: `Revokes one member's explicit grant on this ${label}.`,
      errors: [404],
      operationId: op('removeCollaborator'),
      summary: `Remove a collaborator from a ${label}`,
      tags,
    }),
    requireAuth,
    manage,
    zValidator('param', CollaboratorParamSchema),
    async (c) => controller().removeCollaborator(c),
  );

  return routes;
};

/** Mount keys for `routes/index.ts`: `agents/:resourceId/collaborators` → routes. */
export const collaboratorRouteEntries = Object.fromEntries(
  (Object.keys(COLLABORATOR_RESOURCES) as CollaboratorResourceSegment[]).map((segment) => [
    `${segment}/:resourceId/collaborators`,
    createCollaboratorRoutes(segment),
  ]),
) as Record<`${CollaboratorResourceSegment}/:resourceId/collaborators`, Hono>;
