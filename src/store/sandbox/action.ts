import { type ReplicaSyncResult } from '@/libs/replica';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { initialState, type SandboxState } from './initialState';
import { type InstanceListEdit, SandboxPrivateAction } from './privateAction';
import { SANDBOX_SCOPE_ENTRY, type SandboxPickerInstanceList } from './projection';
import { useSandboxStore } from './store';

const n = setNamespace('sandbox');

type Setter = StoreSetter<SandboxState>;

/** How often a building copy is re-listed while the picker can see it. */
const BUILD_REFRESH_MS = 4000;

interface UseFetchEntitlementOptions {
  /** Revalidate when the window regains focus. Defaults to `true`. */
  revalidateOnFocus?: boolean;
}

export class SandboxActionImpl {
  readonly #private: SandboxPrivateAction;
  readonly #set: Setter;

  constructor(set: Setter, _get: () => SandboxState, privateAction: SandboxPrivateAction) {
    this.#set = set;
    this.#private = privateAction;
  }

  /**
   * The active workspace's sandbox-storage entitlement. Read it with
   * `sandboxSelectors.entitlement`. The composer and the environments page share
   * this one entry, so the two never disagree.
   */
  useFetchEntitlement = (
    enabled: boolean,
    { revalidateOnFocus = true }: UseFetchEntitlementOptions = {},
  ): ReplicaSyncResult =>
    this.#private.entitlement.useSync(enabled ? SANDBOX_SCOPE_ENTRY : null, { revalidateOnFocus });

  /** The picker's environments; read them with `sandboxSelectors.pickerEnvironments`. */
  useFetchPickerEnvironments = (enabled: boolean): ReplicaSyncResult =>
    this.#private.environments.useSync(enabled ? SANDBOX_SCOPE_ENTRY : null);

  /**
   * The picker's copies with `topicId`'s occupancy; read them with
   * `sandboxSelectors.pickerInstances(topicId)`.
   *
   * Not refetched on focus: occupancy is re-read each time the menu opens
   * instead. While a copy is building, the list is polled so "Building" turns
   * into a usable row on its own.
   */
  useFetchPickerInstances = (enabled: boolean, topicId?: string): ReplicaSyncResult =>
    this.#private.instances.useSync(enabled ? { topicId } : null, {
      refreshInterval: (latest?: SandboxPickerInstanceList) =>
        (latest?.instances ?? []).some((instance) => instance.status === 'pending')
          ? BUILD_REFRESH_MS
          : 0,
      revalidateOnFocus: false,
    });

  /**
   * Edit the copies on the client (a just-created copy listed as building) and,
   * unless `revalidate: false`, re-sync them. With no edit it only re-syncs. The
   * edit stays in memory: only a server answer is persisted.
   */
  mutatePickerInstances = async (
    edit?: InstanceListEdit,
    { revalidate = true }: { revalidate?: boolean } = {},
  ): Promise<void> => {
    if (edit) this.#private.editInstances(edit);
    if (!edit || revalidate) await this.#private.instances.revalidate(SANDBOX_SCOPE_ENTRY);
  };

  /** Where a bound instance's files live; read it with `sandboxSelectors.instanceDirectory`. */
  useFetchInstanceDirectory = (instanceId?: string | null): ReplicaSyncResult =>
    this.#private.instanceDirectory.useSync(instanceId || null);

  reset = (): void => {
    this.#set(initialState, false, n('reset'));
  };
}

const { getState, setState } = useSandboxStore;

export const sandboxActions = new SandboxActionImpl(
  setState,
  getState,
  new SandboxPrivateAction(setState, getState),
);
