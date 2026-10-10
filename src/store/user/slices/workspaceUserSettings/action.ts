import type { ReplicaSlice } from '@lobechat/replica/zustand';
import type { WorkspaceUserPreference } from '@lobechat/types';
import { mergeNotificationSettings } from '@lobechat/utils/mergeNotificationSettings';
import isEqual from 'fast-deep-equal';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { createReplicaSlice, type ReplicaLens } from '@/libs/replica';
import { workspaceUserSettingsService } from '@/services/workspaceUserSettings';
import { type StoreSetter } from '@/store/types';
import { type UserStore, useUserStore } from '@/store/user';
import { setNamespace } from '@/utils/storeDebug';

import {
  getWorkspaceUserPreferenceResource,
  type WorkspaceUserPreferenceParams,
} from './projection';

const n = setNamespace('workspaceUserSettings');

type Setter = StoreSetter<UserStore>;

type PreferenceSlice = ReplicaSlice<
  UserStore,
  WorkspaceUserPreferenceParams,
  WorkspaceUserPreference,
  WorkspaceUserPreference | null
>;

/**
 * Fold a preference patch onto the current bucket, mirroring the server's deep
 * merge (`WorkspaceUserSettingsModel`) so an optimistic write never drops a
 * sibling override / notification toggle the DB keeps.
 */
const mergePreference = (
  previous: WorkspaceUserPreference,
  patch: Partial<WorkspaceUserPreference>,
): WorkspaceUserPreference => ({
  ...previous,
  ...patch,
  ...(patch.agentDeviceOverrides
    ? { agentDeviceOverrides: { ...previous.agentDeviceOverrides, ...patch.agentDeviceOverrides } }
    : {}),
  ...(patch.agentModelOverrides
    ? { agentModelOverrides: { ...previous.agentModelOverrides, ...patch.agentModelOverrides } }
    : {}),
  ...(patch.agentModeOverrides
    ? { agentModeOverrides: { ...previous.agentModeOverrides, ...patch.agentModeOverrides } }
    : {}),
  ...(patch.notification
    ? { notification: mergeNotificationSettings(previous.notification, patch.notification) }
    : {}),
  ...(patch.sidebarAgentVisibilityOverrides
    ? {
        sidebarAgentVisibilityOverrides: {
          ...previous.sidebarAgentVisibilityOverrides,
          ...patch.sidebarAgentVisibilityOverrides,
        },
      }
    : {}),
});

/**
 * Single-slot view of the workspace-user preference replica: the active
 * workspace's bucket stays on the long-standing fields
 * (`workspaceUserPreference` + `workspaceUserPreferenceWorkspaceId`), so every
 * existing selector / consumer keeps reading the same place. Only the entry of
 * the active workspace is materialized — the marker gates that.
 */
const workspaceUserPreferenceLens: ReplicaLens<UserStore, WorkspaceUserPreference> = {
  clear: () => ({ workspaceUserPreference: {}, workspaceUserPreferenceWorkspaceId: null }),
  get: (state, key) =>
    state.workspaceUserPreferenceWorkspaceId === key ? state.workspaceUserPreference : undefined,
  keys: (state) =>
    state.workspaceUserPreferenceWorkspaceId === null
      ? []
      : [state.workspaceUserPreferenceWorkspaceId],
  set: (_state, key, data) =>
    data === undefined
      ? { workspaceUserPreference: {}, workspaceUserPreferenceWorkspaceId: null }
      : { workspaceUserPreference: data, workspaceUserPreferenceWorkspaceId: key },
};

/**
 * Slice for the caller's `workspace_user_settings.preference` bucket. Reads go
 * through the replica (local-first, idempotent, scope-partitioned): the
 * identity partition `${userId}:${workspaceId}` owns the workspace boundary, so
 * switching workspaces drops the previous bucket before paint and reads the
 * right one. Personal mode short-circuits without hitting the network — the row
 * doesn't exist there and the server would reject the request.
 *
 * Writes merge the patch into the view optimistically (so a picker observes its
 * pick immediately) and roll the view back if the mutation fails.
 */
export const createWorkspaceUserSettingsSlice = (
  set: Setter,
  get: () => UserStore,
  _api?: unknown,
) => new WorkspaceUserSettingsActionImpl(set, get, _api);

export class WorkspaceUserSettingsActionImpl {
  readonly #get: () => UserStore;
  readonly #set: Setter;
  /**
   * Local-first replica of the active workspace's preference bucket (its view
   * is `workspaceUserPreference`), created on first use rather than in the
   * constructor: `@/libs/replica` reaches `@/store/user` through its
   * cache-scope wiring, and the constructor runs while the user store module is
   * still initializing — evaluating the binding there is a module cycle (see
   * `projection.ts`).
   */
  #preference?: PreferenceSlice;

  constructor(set: Setter, get: () => UserStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  #replica(): PreferenceSlice {
    this.#preference ??= createReplicaSlice(getWorkspaceUserPreferenceResource(), {
      actionPrefix: n('preference'),
      fetcher: () => workspaceUserSettingsService.getPreference(),
      get: this.#get,
      // A `null` response (no server row) reads as the empty bucket; an
      // unchanged response must not re-render every consumer.
      merge: (incoming, confirmed) => {
        const next = incoming ?? {};
        return isEqual(next, confirmed) ? undefined : next;
      },
      set: this.#set,
      stateKey: 'workspaceUserPreferenceReplica',
      view: workspaceUserPreferenceLens,
    });
    return this.#preference;
  }

  /**
   * Sync the active workspace's preference into the store view. Several
   * surfaces mount this (sidebar, chat input, view-all page); the replica
   * dedupes the underlying read by scope + key, so calling it from each is
   * safe. Returns the shape the existing consumers expect
   * (`{ data, isLoading, mutate }`), where `data === undefined` means "not
   * loaded yet — fall back to the store bucket".
   */
  useFetchWorkspaceUserPreference = () => {
    const workspaceId = useActiveWorkspaceId();
    const sync = this.#replica().useSync(workspaceId ? { workspaceId } : null, {
      enabled: !!workspaceId,
    });

    const data = useUserStore((s) =>
      workspaceId && s.workspaceUserPreferenceWorkspaceId === workspaceId
        ? s.workspaceUserPreference
        : undefined,
    );

    return {
      data,
      // Mirrors the old SWR `isLoading`: no value for this workspace yet and
      // the local copy hasn't settled (or the network is still confirming it).
      isLoading: !!workspaceId && data === undefined && (!sync.isHydrated || sync.isValidating),
      mutate: sync.revalidate,
    };
  };

  updateWorkspaceUserPreference = async (
    patch: Partial<WorkspaceUserPreference>,
  ): Promise<void> => {
    const workspaceId = getActiveWorkspaceId();
    const previous = this.#get().workspaceUserPreference;

    // Personal mode (no active workspace) has no row to key on; keep the server
    // call so the pre-migration contract is unchanged.
    if (!workspaceId) {
      await workspaceUserSettingsService.updatePreference(patch);
      return;
    }

    // Seed the active entry when it has not loaded yet, so the optimistic
    // overlay below always has a value to apply onto (a picker can fire before
    // the first hydrate/fetch resolves). `persist: false` — this is not a
    // server-confirmed value.
    this.#replica().update(workspaceId, (data) => data ?? previous, { persist: false });

    // Optimistic merge: the picker's own re-render sees the new choice on the
    // next frame, and a failed write rolls the view back to the pre-write
    // bucket.
    await this.#replica().optimistic(
      workspaceId,
      (data) => mergePreference(data, patch),
      () => workspaceUserSettingsService.updatePreference(patch),
    );
  };
}

export type WorkspaceUserSettingsAction = Pick<
  WorkspaceUserSettingsActionImpl,
  keyof WorkspaceUserSettingsActionImpl
>;
