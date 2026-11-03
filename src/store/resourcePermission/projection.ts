import { defineReplica } from '@/libs/replica';
import type {
  PermissionResourceType,
  ResourceCollaborator,
  ResourceGeneralAccess,
} from '@/services/resourcePermission';

export interface ResourceRef {
  resourceId: string;
  resourceType: PermissionResourceType;
}

/** Entry key of one resource in every resource-permission replica. */
export const resourceKey = ({ resourceId, resourceType }: ResourceRef): string =>
  `${resourceType}:${resourceId}`;

/**
 * The caller's workspace General-access record of one resource. Persisted so a
 * reload renders the last confirmed access (config pages, sidebar menus,
 * composer controls) without waiting for the network; the server still checks
 * every write, and management stays fail-closed until this session re-confirms
 * the record (see `resourceAccessSelectors.isConfirmed`).
 *
 * A record is a few scalar fields, but one is kept per agent / group / page the
 * user opens, so the persisted rows are capped.
 */
export const resourceAccessResource = defineReplica<ResourceRef, ResourceGeneralAccess>({
  key: resourceKey,
  name: 'resourceAccess',
  persist: { maxEntries: 200 },
  storage: 'indexedDB',
  version: 1,
});

/**
 * The collaborator grants of one resource, read by its managers on the
 * Permission page. Memory-only (`storage: 'memory'`): the roster carries other
 * members' names, avatars and emails, and only a current manager may see it. A
 * persisted copy would paint for a former manager on revisit before the server
 * answered 403, so the list only ever holds what this session fetched.
 */
export const resourceCollaboratorsResource = defineReplica<ResourceRef, ResourceCollaborator[]>({
  key: resourceKey,
  name: 'resourceCollaborators',
  storage: 'memory',
  version: 1,
});
