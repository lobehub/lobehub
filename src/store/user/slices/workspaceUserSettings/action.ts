import type { WorkspaceUserPreference } from '@lobechat/types';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { workspaceUserSettingsService } from '@/services/workspaceUserSettings';
import { type StoreSetter } from '@/store/types';
import { type UserStore } from '@/store/user';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('workspaceUserSettings');

const WORKSPACE_USER_SETTINGS_SWR_KEY = 'FETCH_WORKSPACE_USER_SETTINGS';

type Setter = StoreSetter<UserStore>;

/**
 * Slice for the caller's `workspace_user_settings.preference` bucket. Reads
 * are SWR-cached and keyed on the ACTIVE workspaceId — switching workspaces
 * auto-refetches; personal mode short-circuits without hitting the network
 * (the row doesn't exist there and the server would reject the request).
 *
 * Writes go through the tRPC mutation, then merge the returned bucket back
 * into local state so pickers observe their pick immediately without waiting
 * for the SWR revalidation cycle.
 */
export const createWorkspaceUserSettingsSlice = (
  set: Setter,
  get: () => UserStore,
  _api?: unknown,
) => new WorkspaceUserSettingsActionImpl(set, get, _api);

export class WorkspaceUserSettingsActionImpl {
  readonly #get: () => UserStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  useFetchWorkspaceUserPreference = () => {
    const workspaceId = useActiveWorkspaceId();
    return useClientDataSWR<WorkspaceUserPreference | null>(
      workspaceId ? [WORKSPACE_USER_SETTINGS_SWR_KEY, workspaceId] : null,
      async () => workspaceUserSettingsService.getPreference(),
      {
        onSuccess: (data) => {
          if (!data) return;
          this.#set(
            { workspaceUserPreference: data },
            false,
            n('useFetchWorkspaceUserPreference/onSuccess'),
          );
        },
      },
    );
  };

  updateWorkspaceUserPreference = async (
    patch: Partial<WorkspaceUserPreference>,
  ): Promise<void> => {
    // Optimistic merge — the picker's own re-render should see the new
    // choice on the very next frame, not wait for the mutation round-trip.
    const previous = this.#get().workspaceUserPreference;
    const optimistic: WorkspaceUserPreference = { ...previous, ...patch };
    this.#set(
      { workspaceUserPreference: optimistic },
      false,
      n('updateWorkspaceUserPreference/optimistic'),
    );

    try {
      await workspaceUserSettingsService.updatePreference(patch);
    } catch (error) {
      // Roll back the optimistic write so the picker doesn't strand a state
      // that never made it to the server.
      this.#set(
        { workspaceUserPreference: previous },
        false,
        n('updateWorkspaceUserPreference/rollback'),
      );
      throw error;
    }
  };
}

export type WorkspaceUserSettingsAction = Pick<
  WorkspaceUserSettingsActionImpl,
  keyof WorkspaceUserSettingsActionImpl
>;
