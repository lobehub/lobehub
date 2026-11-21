import { cacheScope, createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import type {
  ResourceAccessLevel,
  ResourceCollaborator,
  ResourceGeneralAccess,
} from '@/services/resourcePermission';
import { resourcePermissionService } from '@/services/resourcePermission';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';
import { isTrpcErrorCode } from '@/utils/trpcError';

import {
  initialState,
  type ResourceAccessCheck,
  type ResourcePermissionState,
} from './initialState';
import {
  resourceAccessResource,
  resourceCollaboratorsResource,
  resourceKey,
  type ResourceRef,
} from './projection';
import { accessSessionKey } from './selectors';
import { useResourcePermissionStore } from './store';

const n = setNamespace('resourcePermission');

type Setter = StoreSetter<ResourcePermissionState>;

/**
 * Failures that are the server's answer rather than a transport fault: the
 * resource went private, left the workspace, or the caller lost access.
 */
export const isAccessDenialError = (error: unknown): boolean =>
  isTrpcErrorCode(error, 'NOT_FOUND') ||
  isTrpcErrorCode(error, 'FORBIDDEN') ||
  isTrpcErrorCode(error, 'UNAUTHORIZED');

export class ResourcePermissionActionImpl {
  readonly #access;
  readonly #collaborators;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ResourcePermissionState) {
    this.#set = set;

    this.#access = createReplicaSlice(resourceAccessResource, {
      actionPrefix: 'resourceAccess',
      effects: {
        // Every server answer, unchanged ones included, re-confirms the record
        // for this session — that is what management checks wait for.
        onApplied: (_data, _params, { key, scope }) => this.#markAccess(scope, key, 'confirmed'),
        onError: (error, _params, { key, scope }) => {
          if (key === undefined || !isAccessDenialError(error)) return;
          // The persisted grant no longer holds: drop it so neither this view
          // nor a reload acts on it, and fail every check closed.
          this.#markAccess(scope, key, 'denied');
          void this.#access.remove(key, scope);
        },
      },
      fetcher: ({ resourceId, resourceType }) =>
        resourcePermissionService.getGeneralAccess(resourceType, resourceId),
      get,
      set,
      stateKey: 'accessReplica',
      view: recordLens<ResourcePermissionState, ResourceGeneralAccess>('accessMap'),
    });

    this.#collaborators = createReplicaSlice(resourceCollaboratorsResource, {
      actionPrefix: 'resourceCollaborators',
      effects: {
        onError: (error, _params, { key, scope }) => {
          // Only managers may list grants; a caller who lost that must not
          // keep (or reload) the list they saw before.
          if (key !== undefined && isAccessDenialError(error)) {
            void this.#collaborators.remove(key, scope);
          }
        },
      },
      fetcher: ({ resourceId, resourceType }) =>
        resourcePermissionService.listCollaborators(resourceType, resourceId),
      get,
      set,
      stateKey: 'collaboratorsReplica',
      view: recordLens<ResourcePermissionState, ResourceCollaborator[]>('collaboratorsMap'),
    });
  }

  #markAccess = (scope: string, key: string, check: ResourceAccessCheck): void => {
    this.#set(
      (s) => ({
        accessSessionMap: { ...s.accessSessionMap, [accessSessionKey(scope, key)]: check },
      }),
      false,
      n('markAccess', { check, key }),
    );
  };

  /**
   * A management write the server refused proves this session's `confirmed`
   * manage grant is stale (the caller was demoted after the access read).
   * Withdraw the confirmation so manage controls close at once, drop the
   * manager-only roster, and re-fetch the record — `fresh`, so a read that
   * started before the demotion cannot land and re-confirm the old grant.
   */
  #onManagementRefused = (ref: ResourceRef, scope: string, error: unknown): void => {
    if (!isAccessDenialError(error) || cacheScope.get() !== scope) return;
    const key = resourceKey(ref);
    const sessionKey = accessSessionKey(scope, key);
    this.#set(
      (s) => {
        if (s.accessSessionMap[sessionKey] !== 'confirmed') return s;
        const { [sessionKey]: _, ...accessSessionMap } = s.accessSessionMap;
        return { accessSessionMap };
      },
      false,
      n('withdrawAccess', { key }),
    );
    void this.#collaborators.remove(key, scope);
    this.#access.fetch(ref, { fresh: true, scope }).catch(() => {});
  };

  /** Run a management write, reacting to a refusal before rethrowing it. */
  #manage = async <T>(ref: ResourceRef, write: () => Promise<T>): Promise<T> => {
    const scope = cacheScope.get();
    try {
      return await write();
    } catch (error) {
      this.#onManagementRefused(ref, scope, error);
      throw error;
    }
  };

  useFetchAccess = (ref: ResourceRef | null): ReplicaSyncResult => this.#access.useSync(ref);

  /**
   * Seed the persisted access record before a route commits (see the route
   * loaders in `@/features/ResourcePermission/accessLoader`), so a config page
   * decides from it on the first frame instead of after `useSync` hydrates.
   */
  preHydrateAccess = (ref: ResourceRef): Promise<boolean> => {
    const scope = cacheScope.get();
    // The slot may still hold the previous identity's rows; drop them before seeding.
    this.#access.ensureScope(scope);
    return this.#access.hydrate(ref, scope);
  };

  useFetchCollaborators = (ref: ResourceRef | null): ReplicaSyncResult =>
    this.#collaborators.useSync(ref);

  setAccessLevel = async (ref: ResourceRef, accessLevel: ResourceAccessLevel): Promise<void> => {
    const scope = cacheScope.get();
    const key = resourceKey(ref);
    await this.#manage(ref, () =>
      this.#access.optimistic(
        key,
        (data) => ({
          ...data,
          accessLevel,
          generalAccess: accessLevel === 'edit' ? 'editor' : 'viewer',
        }),
        () =>
          resourcePermissionService.setAccessLevel(ref.resourceType, ref.resourceId, accessLevel),
        { confirm: (result) => () => result },
      ),
    );
    // The write's response is a server answer too.
    if (cacheScope.get() === scope) this.#markAccess(scope, key, 'confirmed');
  };

  addCollaborators = async (
    ref: ResourceRef,
    userIds: string[],
    accessLevel: ResourceAccessLevel,
  ): Promise<void> => {
    await this.#manage(ref, () =>
      resourcePermissionService.addCollaborators(
        ref.resourceType,
        ref.resourceId,
        userIds,
        accessLevel,
      ),
    );
    await this.#collaborators.fetch(ref, { fresh: true });
  };

  /**
   * The row disappears immediately and comes back if the server rejects the
   * revocation (the caller surfaces the error).
   */
  removeCollaborator = async (ref: ResourceRef, userId: string): Promise<void> => {
    await this.#manage(ref, () =>
      this.#collaborators.optimistic(
        resourceKey(ref),
        (list) => list.filter((item) => item.userId !== userId),
        () =>
          resourcePermissionService.removeCollaborator(ref.resourceType, ref.resourceId, userId),
      ),
    );
    await this.#collaborators.fetch(ref, { fresh: true });
  };

  reset = (): void => {
    // `clear()` advances each replica's clear generation, so a read still in
    // flight from the previous data context (e.g. a Desktop server switch that
    // resolves to the same scope string) is discarded instead of repopulating
    // the maps and re-confirming a manage grant. It also drops this scope's
    // persisted access rows, which that context wrote.
    void this.#access.clear();
    void this.#collaborators.clear();
    this.#set(initialState, false, n('reset'));
  };
}

const { getState, setState } = useResourcePermissionStore;

export const resourcePermissionActions = new ResourcePermissionActionImpl(setState, getState);
