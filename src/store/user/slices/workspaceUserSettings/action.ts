import type { WorkspaceUserPreference } from '@lobechat/types';
import { mergeNotificationSettings } from '@lobechat/utils/mergeNotificationSettings';
import isEqual from 'fast-deep-equal';
import type { ReplicaSlice } from 'local-replica/zustand';
import { useSyncExternalStore } from 'react';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { createReplicaSlice, type ReplicaLens } from '@/libs/replica';
import { workspaceUserSettingsService } from '@/services/workspaceUserSettings';
import { refreshAgentDeviceBindings } from '@/store/device/agentDeviceBinding';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import type { UserState } from '../../initialState';
import type { UserStore } from '../../store';
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
 * Read side of the store api this slice needs to observe its own view. It reads
 * through the store instead of importing `useUserStore`: this slice is part of
 * that store, so a value import closes the `store → slice → store` module cycle
 * the circular lint rejects (see `useFetchWorkspaceUserPreference`).
 */
interface PreferenceStoreApi {
  getState: () => UserState;
  subscribe: (listener: () => void) => () => void;
}

/** Never notifies — what the snapshot falls back to when no store api is wired. */
const EMPTY_SUBSCRIBE = () => () => {};

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
  _api?: PreferenceStoreApi,
) => new WorkspaceUserSettingsActionImpl(set, get, _api);

export class WorkspaceUserSettingsActionImpl {
  readonly #api: PreferenceStoreApi | undefined;
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

  constructor(set: Setter, get: () => UserStore, _api?: PreferenceStoreApi) {
    this.#api = _api;
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

    // Read the view through the store api rather than `useUserStore`: importing
    // the store hook here would close a `store → slice → store` module cycle
    // (`dpdm` rejects it). Same reactive read, no module edge — the shape
    // mirrors `useChatInputResourceAccess`.
    const api = this.#api;
    const data = useSyncExternalStore(
      api ? api.subscribe : EMPTY_SUBSCRIBE,
      () => {
        const state = api ? api.getState() : this.#get();
        return workspaceId && state.workspaceUserPreferenceWorkspaceId === workspaceId
          ? state.workspaceUserPreference
          : undefined;
      },
      () => undefined,
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

    const replica = this.#replica();

    // A picker can fire before the local copy was read. Read it first: seeding
    // an entry now would make the persisted bucket unhydratable (hydration only
    // fills an empty slot), so a failed write would hide the cached overrides
    // and a successful one would persist the bare patch over them. Only a write
    // that finds nothing loaded pays for the (local, IndexedDB) read.
    if (replica.getConfirmed(workspaceId) === undefined) {
      await replica.hydrate({ workspaceId });

      // The active workspace can change while the (local, IndexedDB) read is
      // pending. Everything after this point — the local seed/overlay and, above
      // all, the service call, which carries the *current* workspace context —
      // would then apply a preference picked in the previous workspace to the
      // new one. Abandon the write: the pick belonged to the workspace that was
      // active when it was made.
      if (getActiveWorkspaceId() !== workspaceId) return;
    }

    // Seed the active entry when there is still nothing loaded (no local copy),
    // so the optimistic overlay below always has a value to apply onto.
    // `persist: false` — this is not a server-confirmed value.
    replica.update(workspaceId, (data) => data ?? previous, { persist: false });

    // Optimistic merge: the picker's own re-render sees the new choice on the
    // next frame, and a failed write rolls the view back to the pre-write
    // bucket. Revalidate once the write settles: it supersedes a read that
    // started before the write (the driver discards that response), which
    // would otherwise land after the overlay is gone and restore the old value
    // in the view and IndexedDB.
    await replica.optimistic(
      workspaceId,
      (data) => mergePreference(data, patch),
      () => workspaceUserSettingsService.updatePreference(patch),
      { revalidate: true },
    );
    // The caller's per-agent device override changes where an agent routes for
    // them, which the sidebar presence dots cache per agent. (Personal mode
    // has no overrides, so the early return above needs no refresh.)
    if (patch.agentDeviceOverrides) void refreshAgentDeviceBindings();
  };
}

export type WorkspaceUserSettingsAction = Pick<
  WorkspaceUserSettingsActionImpl,
  keyof WorkspaceUserSettingsActionImpl
>;
