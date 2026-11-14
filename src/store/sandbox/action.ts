import type { EnvironmentVisibility } from '@lobechat/types';

import { type ReplicaSyncResult } from '@/libs/replica';
import {
  environmentService,
  type NewEnvironmentSpecification,
  type SandboxEnvironmentSpecification,
} from '@/services/environment';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { initialState, type SandboxState } from './initialState';
import { type InstanceListEdit, SandboxPrivateAction } from './privateAction';
import {
  SANDBOX_SCOPE_ENTRY,
  type SandboxEnvironment,
  type SandboxPickerInstanceList,
  toEnvironmentPool,
} from './projection';
import { useSandboxStore } from './store';

const n = setNamespace('sandbox');

type Setter = StoreSetter<SandboxState>;

/** How often a building copy is re-listed while the picker can see it. */
const BUILD_REFRESH_MS = 4000;

/**
 * Readers of one pool mounted together (the page, the picker, the folder
 * dialog) share one request. Explicit refreshes and writes bypass it.
 */
const ENVIRONMENTS_DEDUPE_MS = 10_000;

/** A new environment as `createEnvironment` returns it: the definition alone. */
export type CreatedEnvironment = Awaited<ReturnType<typeof environmentService.createEnvironment>>;

interface UseFetchEntitlementOptions {
  /** Revalidate when the window regains focus. Defaults to `true`. */
  revalidateOnFocus?: boolean;
}

export class SandboxActionImpl {
  readonly #private: SandboxPrivateAction;
  readonly #get: () => SandboxState;
  readonly #set: Setter;

  constructor(set: Setter, get: () => SandboxState, privateAction: SandboxPrivateAction) {
    this.#get = get;
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

  /**
   * One pool of environments; read it with `sandboxSelectors.environments`.
   * `visibility` omitted is every environment the caller can see.
   */
  useFetchEnvironments = (visibility?: EnvironmentVisibility): ReplicaSyncResult =>
    this.#private.environments.useSync(toEnvironmentPool(visibility), {
      dedupingInterval: ENVIRONMENTS_DEDUPE_MS,
    });

  /** The picker's environments; read them with `sandboxSelectors.pickerEnvironments`. */
  useFetchPickerEnvironments = (enabled: boolean): ReplicaSyncResult =>
    this.#private.environments.useSync(enabled ? 'all' : null, {
      dedupingInterval: ENVIRONMENTS_DEDUPE_MS,
    });

  /**
   * Re-sync every mounted pool. Every pool, not the one a caller is looking
   * at: publishing moves an environment from one pool to the other.
   */
  refreshEnvironments = async (): Promise<void> => {
    await this.#private.environments.revalidate();
  };

  /** Returns the definition, so the caller can open what it made. */
  createEnvironment = async (params: {
    configuration?: NewEnvironmentSpecification;
    description?: string;
    name: string;
    visibility?: EnvironmentVisibility;
  }): Promise<CreatedEnvironment> => {
    const created = await environmentService.createEnvironment(params);
    await this.refreshEnvironments();

    return created;
  };

  updateEnvironment = async (params: {
    configuration?: SandboxEnvironmentSpecification;
    description?: string;
    id: string;
    name?: string;
  }): Promise<void> => {
    await environmentService.updateEnvironment(params);
    const { description, id, name } = params;
    // The facts a row shows land at once, in every pool and in storage; the
    // configuration comes back with the refresh, the way it is stored.
    this.#private.environments.updateEntity<SandboxEnvironment>(id, (environment) => ({
      ...environment,
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
    }));
    await this.refreshEnvironments();
  };

  /**
   * Gone from every pool and from storage as soon as the server agrees, so a
   * reload before the refresh lands cannot restore it.
   */
  removeEnvironment = async (id: string): Promise<void> => {
    await environmentService.removeEnvironment({ id });
    this.#private.environments.removeEntity(id);
    await this.refreshEnvironments();
  };

  /**
   * Moves the row from one pool to the other as soon as the server agrees: out
   * of the pool it left, into the pool it joined when that pool is loaded.
   */
  setEnvironmentVisibility = async ({
    id,
    visibility,
  }: {
    id: string;
    visibility: EnvironmentVisibility;
  }): Promise<void> => {
    await environmentService.setEnvironmentVisibility({ id, visibility });
    const slice = this.#private.environments;
    const left: EnvironmentVisibility = visibility === 'public' ? 'private' : 'public';
    const pools = this.#get().sandboxEnvironmentsMap;
    const current = [pools.all, pools[left], pools[visibility]]
      .flatMap((list) => list ?? [])
      .find((environment) => environment.id === id);

    slice.updateEntity<SandboxEnvironment>(id, (environment) => ({ ...environment, visibility }));
    slice.update(left, (list) => list?.filter((environment) => environment.id !== id));
    if (current)
      slice.update(visibility, (list) =>
        list && !list.some((environment) => environment.id === id)
          ? [...list, { ...current, visibility }].sort((a, b) =>
              a.createdAt.localeCompare(b.createdAt),
            )
          : list,
      );
    await this.refreshEnvironments();
  };

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
