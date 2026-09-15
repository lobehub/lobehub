import { lambdaClient } from '@/libs/trpc/client';

export type PermissionResourceType = 'agent' | 'agentGroup' | 'document' | 'knowledgeBase';
export type ResourceAccessLevel = 'edit' | 'use' | 'view';

export interface ResourceGeneralAccess {
  accessLevel: ResourceAccessLevel;
  canManage: boolean;
  creatorId: string;
  /** @deprecated Compatibility value returned for released clients. */
  generalAccess: 'editor' | 'viewer';
  visibility: 'private' | 'public';
}

export interface ResourceCollaborator {
  accessLevel: ResourceAccessLevel;
  /** `null` when the member's account no longer exists — the grant stays revocable. */
  user: {
    avatar: string | null;
    email: string | null;
    fullName: string | null;
    id: string;
    username: string | null;
  } | null;
  userId: string;
}

class ResourcePermissionService {
  listCollaborators = async (
    resourceType: PermissionResourceType,
    resourceId: string,
  ): Promise<ResourceCollaborator[]> => {
    return lambdaClient.resourcePermission.listCollaborators.query({ resourceId, resourceType });
  };

  addCollaborators = async (
    resourceType: PermissionResourceType,
    resourceId: string,
    userIds: string[],
    accessLevel: ResourceAccessLevel,
  ): Promise<void> => {
    await lambdaClient.resourcePermission.addCollaborators.mutate({
      accessLevel,
      resourceId,
      resourceType,
      userIds,
    });
  };

  removeCollaborator = async (
    resourceType: PermissionResourceType,
    resourceId: string,
    userId: string,
  ): Promise<void> => {
    await lambdaClient.resourcePermission.removeCollaborator.mutate({
      resourceId,
      resourceType,
      userId,
    });
  };

  getGeneralAccess = async (
    resourceType: PermissionResourceType,
    resourceId: string,
  ): Promise<ResourceGeneralAccess> => {
    return lambdaClient.resourcePermission.getGeneralAccess.query({ resourceId, resourceType });
  };

  setAccessLevel = async (
    resourceType: PermissionResourceType,
    resourceId: string,
    accessLevel: ResourceAccessLevel,
  ): Promise<ResourceGeneralAccess> => {
    return lambdaClient.resourcePermission.setGeneralAccess.mutate({
      accessLevel,
      resourceId,
      resourceType,
    });
  };
}

export const resourcePermissionService = new ResourcePermissionService();
