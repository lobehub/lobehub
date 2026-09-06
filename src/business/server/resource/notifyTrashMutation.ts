export type ResourceTrashMutationEvent = 'deleted' | 'restored';
export type ResourceTrashMutationType = 'document' | 'file' | 'knowledgeBase';

export interface NotifyResourceTrashMutationParams {
  actorUserId: string;
  event: ResourceTrashMutationEvent;
  recipientUserId: string;
  resourceId: string;
  resourceTitle: string | null;
  resourceType: ResourceTrashMutationType;
  trashItemId: string;
  workspaceId: string;
}

/** Optional delivery hook for shared workspace resource lifecycle events. */
export const notifyResourceTrashMutation = (
  _params: NotifyResourceTrashMutationParams,
): Promise<void> => Promise.resolve();
