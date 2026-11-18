import type { PermissionResourceType } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { resourcePermissionRouter } from '@/server/routers/lambda/resourcePermission';

import { BaseService } from '../common/base.service';
import type {
  AddCollaboratorsRequest,
  AddedCollaborators,
  Collaborator,
  GeneralAccess,
  SetGeneralAccessRequest,
} from '../types/collaborator.type';
import type { DeletedResource } from '../types/common.type';
import { toIso } from './workspace.service';

interface GrantRow {
  accessLevel: Collaborator['accessLevel'];
  createdAt: Date | string;
  user: {
    avatar: string | null;
    email: string | null;
    fullName: string | null;
    id: string;
    username: string | null;
  } | null;
  userId: string;
}

const toCollaborator = (row: GrantRow): Collaborator => ({
  accessLevel: row.accessLevel,
  createdAt: toIso(row.createdAt),
  user: row.user,
  userId: row.userId,
});

const toGeneralAccess = (state: {
  accessLevel: GeneralAccess['accessLevel'];
  canManage: boolean;
  creatorId: string;
  visibility: GeneralAccess['visibility'];
}): GeneralAccess => ({
  accessLevel: state.accessLevel,
  canManage: state.canManage,
  creatorId: state.creatorId,
  visibility: state.visibility,
});

/**
 * Collaborators REST service.
 *
 * A thin shell over the `resourcePermission` tRPC router, which owns every
 * rule: the resource must live in the request's workspace (anything else is a
 * 404, including another member's private resource), only its creator or a
 * workspace owner may manage it, every collaborator must be an active member,
 * and each resource type accepts only its own access levels. Permissions only
 * exist inside a team workspace, so a personal request is a 400.
 */
export class CollaboratorRestService extends BaseService {
  constructor(
    db: LobeChatDatabase,
    userId: string | null,
    workspaceId: string | undefined,
    private readonly resourceType: PermissionResourceType,
  ) {
    super(db, userId, workspaceId);
  }

  private get permissions() {
    return resourcePermissionRouter.createCaller({
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
  }

  private target(resourceId: string) {
    return { resourceId, resourceType: this.resourceType };
  }

  async listCollaborators(resourceId: string): Promise<Collaborator[]> {
    const rows = await this.permissions.listCollaborators(this.target(resourceId));
    return (rows as GrantRow[]).map(toCollaborator);
  }

  async addCollaborators(
    resourceId: string,
    body: AddCollaboratorsRequest,
  ): Promise<AddedCollaborators> {
    await this.permissions.addCollaborators({
      ...this.target(resourceId),
      accessLevel: body.accessLevel,
      userIds: body.userIds,
    });
    const requested = new Set(body.userIds);
    const items = (await this.listCollaborators(resourceId)).filter((row) =>
      requested.has(row.userId),
    );
    return { items };
  }

  async removeCollaborator(resourceId: string, userId: string): Promise<DeletedResource> {
    await this.permissions.removeCollaborator({ ...this.target(resourceId), userId });
    return { deleted: true, id: userId };
  }

  async getGeneralAccess(resourceId: string): Promise<GeneralAccess> {
    return toGeneralAccess(await this.permissions.getGeneralAccess(this.target(resourceId)));
  }

  async setGeneralAccess(
    resourceId: string,
    body: SetGeneralAccessRequest,
  ): Promise<GeneralAccess> {
    return toGeneralAccess(
      await this.permissions.setGeneralAccess({
        ...this.target(resourceId),
        accessLevel: body.accessLevel,
      }),
    );
  }
}
