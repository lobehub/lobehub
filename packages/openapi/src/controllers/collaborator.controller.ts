import type { Context } from 'hono';

import type { PermissionResourceType } from '@/database/schemas';

import { BaseController } from '../common/base.controller';
import { CollaboratorRestService } from '../services/collaborator.service';
import { pageOf } from '../services/workspace.service';
import type {
  AddCollaboratorsRequest,
  CollaboratorListQuery,
  CollaboratorParam,
  CollaboratorResourceParam,
  SetGeneralAccessRequest,
} from '../types/collaborator.type';

/**
 * Collaborators controller, bound to one permission resource type.
 * Handles HTTP concerns only — the ACL rules live in `resourcePermission`.
 */
export class CollaboratorController extends BaseController {
  constructor(private readonly resourceType: PermissionResourceType) {
    super();
  }

  private async service(c: Context): Promise<CollaboratorRestService> {
    return new CollaboratorRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
      this.resourceType,
    );
  }

  private async run(c: Context, handler: () => Promise<Response>): Promise<Response> {
    try {
      return await handler();
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET …/{resourceId}/collaborators */
  listCollaborators(c: Context) {
    return this.run(c, async () => {
      const { resourceId } = this.getParams<CollaboratorResourceParam>(c);
      const query = this.getQuery<CollaboratorListQuery>(c);
      const collaborators = await (await this.service(c)).listCollaborators(resourceId);
      return this.list(c, 'items', pageOf(collaborators, query), { pagination: query });
    });
  }

  /** POST …/{resourceId}/collaborators */
  addCollaborators(c: Context) {
    return this.run(c, async () => {
      const { resourceId } = this.getParams<CollaboratorResourceParam>(c);
      const body = await this.getBody<AddCollaboratorsRequest>(c);
      return this.success(
        c,
        await (await this.service(c)).addCollaborators(resourceId, body),
        'Collaborators added',
      );
    });
  }

  /** DELETE …/{resourceId}/collaborators/{userId} */
  removeCollaborator(c: Context) {
    return this.run(c, async () => {
      const { resourceId, userId } = this.getParams<CollaboratorParam>(c);
      return this.success(
        c,
        await (await this.service(c)).removeCollaborator(resourceId, userId),
        'Collaborator removed',
      );
    });
  }

  /** GET …/{resourceId}/collaborators/general-access */
  getGeneralAccess(c: Context) {
    return this.run(c, async () => {
      const { resourceId } = this.getParams<CollaboratorResourceParam>(c);
      return this.success(c, await (await this.service(c)).getGeneralAccess(resourceId));
    });
  }

  /** PUT …/{resourceId}/collaborators/general-access */
  setGeneralAccess(c: Context) {
    return this.run(c, async () => {
      const { resourceId } = this.getParams<CollaboratorResourceParam>(c);
      const body = await this.getBody<SetGeneralAccessRequest>(c);
      return this.success(
        c,
        await (await this.service(c)).setGeneralAccess(resourceId, body),
        'General access updated',
      );
    });
  }
}
