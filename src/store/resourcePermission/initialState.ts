import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { ResourceCollaborator, ResourceGeneralAccess } from '@/services/resourcePermission';

/**
 * What the server last answered for an access record during this page
 * session, keyed by `${scope}|${resourceKey}`. A hydrated record has no entry:
 * it may predate a downgrade, so it vouches for nothing that needs a fresh
 * answer (management controls, redirects).
 */
export type ResourceAccessCheck = 'confirmed' | 'denied';

export interface ResourcePermissionState {
  /** General-access record per `resourceKey` (replica view). */
  accessMap: Record<string, ResourceGeneralAccess>;
  /** Local-first bookkeeping for `accessMap`. */
  accessReplica: ReplicaState<ResourceGeneralAccess>;
  accessSessionMap: Record<string, ResourceAccessCheck>;
  /** Collaborator grants per `resourceKey` (replica view). */
  collaboratorsMap: Record<string, ResourceCollaborator[]>;
  /** Local-first bookkeeping for `collaboratorsMap`. */
  collaboratorsReplica: ReplicaState<ResourceCollaborator[]>;
}

export const initialState: ResourcePermissionState = {
  accessMap: {},
  accessReplica: createReplicaState(),
  accessSessionMap: {},
  collaboratorsMap: {},
  collaboratorsReplica: createReplicaState(),
};
