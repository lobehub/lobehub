import { lambdaClient } from '@/libs/trpc/client';

export type TransferRequestResourceType = 'agent' | 'agentGroup';

export interface TransferRequestParty {
  avatar: string | null;
  fullName: string | null;
  id: string;
  username: string | null;
}

export interface PendingTransferRequest {
  createdAt: Date | string;
  expiresAt: Date | string;
  id: string;
  initiator: TransferRequestParty | null;
  initiatorId: string;
  previousOwnerId: string | null;
  recipient: TransferRequestParty | null;
  recipientId: string;
  resource: {
    avatar: string | null;
    backgroundColor: string | null;
    id: string;
    title: string | null;
  } | null;
  resourceId: string;
  resourceType: string;
  status: string;
  workspaceId: string;
}

/**
 * What a handover will carry — shown to both parties so neither commits blind:
 * bot bindings and cron jobs transfer DISABLED, device bindings may reset,
 * other users' task assignments on a private agent detach.
 */
export interface TransferManifest {
  botBindings: number;
  botPlatforms: string[];
  connectorsAffected: number;
  cronJobs: number;
  deviceBindingAffected: boolean;
  expertiseAffected: number;
  groupsToLeave: number;
  hiddenReferencedMember: boolean;
  knowledgeToDetach: number;
  ownerId: string;
  projectsToLeave: number;
  tasksToDetach: number;
}

/**
 * Member-to-member ownership transfer requests (workspace only). The pending
 * request is visible to its two parties; accept/decline are recipient actions,
 * cancel is the initiator's withdrawal.
 */
class ResourceTransferRequestService {
  /** The transfer's impact summary; callable by either party or an authorized initiator. */
  getManifest = async (params: {
    recipientId: string;
    resourceId: string;
    resourceType: TransferRequestResourceType;
  }): Promise<TransferManifest> => {
    const result = await lambdaClient.resourceTransferRequest.getTransferManifest.query(params);
    return result.data as TransferManifest;
  };

  getPendingByResource = async (
    resourceType: TransferRequestResourceType,
    resourceId: string,
  ): Promise<PendingTransferRequest | null> => {
    const result = await lambdaClient.resourceTransferRequest.getPendingByResource.query({
      resourceId,
      resourceType,
    });
    return (result.data as PendingTransferRequest | null) ?? null;
  };

  /** Live requests where the caller is recipient (to answer) or initiator (to withdraw). */
  listMine = async (): Promise<PendingTransferRequest[]> => {
    const result = await lambdaClient.resourceTransferRequest.listMine.query();
    return (result.data as PendingTransferRequest[]) ?? [];
  };

  accept = async (requestId: string): Promise<void> => {
    await lambdaClient.resourceTransferRequest.accept.mutate({ requestId });
  };

  decline = async (requestId: string): Promise<void> => {
    await lambdaClient.resourceTransferRequest.decline.mutate({ requestId });
  };

  cancel = async (requestId: string): Promise<void> => {
    await lambdaClient.resourceTransferRequest.cancel.mutate({ requestId });
  };
}

export const resourceTransferRequestService = new ResourceTransferRequestService();
