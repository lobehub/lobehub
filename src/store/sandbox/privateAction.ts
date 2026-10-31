import { createReplicaSlice, recordLens } from '@/libs/replica';
import { environmentService } from '@/services/environment';
import { sandboxStorageService } from '@/services/sandboxStorage';
import type { StoreSetter } from '@/store/types';

import { type SandboxState } from './initialState';
import {
  SANDBOX_SCOPE_ENTRY,
  type SandboxEntitlement,
  sandboxEntitlementResource,
  sandboxEnvironmentsResource,
  type SandboxInstanceDirectory,
  sandboxInstanceDirectoryResource,
  sandboxInstancesResource,
  type SandboxPickerEnvironment,
  type SandboxPickerInstance,
  type SandboxPickerInstanceList,
  toInstanceDirectory,
  toPickerEnvironment,
  toPickerInstance,
  toSandboxEntitlement,
} from './projection';

type Setter = StoreSetter<SandboxState>;

export type InstanceListEdit = (
  previous: SandboxPickerInstanceList | undefined,
) => SandboxPickerInstanceList | undefined;

/** A copy created on this client, and the last listing that started before it. */
interface LocalCopy {
  instance: SandboxPickerInstance;
  since: number;
}

export class SandboxPrivateAction {
  readonly #get: () => SandboxState;
  /** Copies created here that a listing in flight may not know about yet. */
  readonly #localCopies = new Map<string, LocalCopy>();
  /** Sequence of `listInstances` calls, so an answer knows when it was asked. */
  #listSeq = 0;
  readonly entitlement;
  readonly environments;
  readonly instanceDirectory;
  readonly instances;

  constructor(set: Setter, get: () => SandboxState) {
    this.#get = get;
    this.entitlement = createReplicaSlice(sandboxEntitlementResource, {
      actionPrefix: 'sandboxEntitlement',
      fetcher: async () => toSandboxEntitlement(await sandboxStorageService.getEntitlement()),
      get,
      set,
      stateKey: 'sandboxEntitlementReplica',
      view: recordLens<SandboxState, SandboxEntitlement>('sandboxEntitlementMap'),
    });
    this.environments = createReplicaSlice(sandboxEnvironmentsResource, {
      actionPrefix: 'sandboxEnvironments',
      fetcher: async () => {
        const { environments } = await environmentService.listEnvironments();
        return environments.map(toPickerEnvironment);
      },
      get,
      set,
      stateKey: 'sandboxEnvironmentsReplica',
      view: recordLens<SandboxState, SandboxPickerEnvironment[]>('sandboxEnvironmentsMap'),
    });
    // The conversation the instance list was last asked for. Every topic shares
    // one entry and one storage key, so the replica's own guard cannot tell a
    // superseded topic's late answer from the current one; this does.
    let askedTopicId: string | null | undefined;
    this.instances = createReplicaSlice(sandboxInstancesResource, {
      actionPrefix: 'sandboxInstances',
      // Names, not sizes: sizes need a live sandbox session to answer.
      fetcher: async ({ topicId }) => {
        const asked = topicId ?? null;
        askedTopicId = asked;
        const seq = ++this.#listSeq;
        const { instances } = await sandboxStorageService.listInstances({
          topicId,
          withSizes: false,
        });
        const answer = {
          instances: this.#withLocalCopies(instances.map(toPickerInstance), seq),
          topicId: asked,
        };
        // Another conversation was asked for since: keep what the entry holds
        // rather than let this answer overwrite that conversation's occupancy.
        if (askedTopicId !== asked) return get().sandboxInstancesMap[SANDBOX_SCOPE_ENTRY] ?? answer;

        return answer;
      },
      get,
      set,
      stateKey: 'sandboxInstancesReplica',
      // Only a server answer is persisted: copies merged in from this client
      // stay in memory until a listing names them.
      toPersisted: (data) =>
        this.#localCopies.size === 0
          ? data
          : {
              ...data,
              instances: data.instances.filter((instance) => !this.#localCopies.has(instance.id)),
            },
      view: recordLens<SandboxState, SandboxPickerInstanceList>('sandboxInstancesMap'),
    });
    this.instanceDirectory = createReplicaSlice(sandboxInstanceDirectoryResource, {
      actionPrefix: 'sandboxInstanceDirectory',
      fetcher: async (id) => toInstanceDirectory(await sandboxStorageService.getInstance({ id })),
      get,
      set,
      stateKey: 'sandboxInstanceDirectoryReplica',
      // A gone instance is a panel state: never persist it, and evict the
      // directory persisted earlier so a reload cannot point at it again.
      toPersisted: (data) => (data.workingDirectory === null ? null : data),
      view: recordLens<SandboxState, SandboxInstanceDirectory>('sandboxInstanceDirectoryMap'),
    });
  }

  /**
   * Apply a client edit to the copies in memory, remembering any copy it adds.
   * The copy already exists on the server, so only a listing that started
   * before the edit can answer without it.
   */
  editInstances = (edit: InstanceListEdit) => {
    const before = new Set(
      this.#get().sandboxInstancesMap[SANDBOX_SCOPE_ENTRY]?.instances.map(({ id }) => id),
    );
    this.instances.update(SANDBOX_SCOPE_ENTRY, edit, { persist: false });
    const after = this.#get().sandboxInstancesMap[SANDBOX_SCOPE_ENTRY]?.instances ?? [];
    for (const instance of after)
      if (!before.has(instance.id))
        this.#localCopies.set(instance.id, { instance, since: this.#listSeq });
  };

  /**
   * Keep a client-created copy in an answer from a listing that started before
   * it was made. A listing that started after is authoritative: whether or not
   * it names the copy, the local record is done.
   */
  #withLocalCopies = (instances: SandboxPickerInstance[], seq: number) => {
    if (this.#localCopies.size === 0) return instances;
    const listed = new Set(instances.map(({ id }) => id));
    const merged = [...instances];
    for (const [id, { instance, since }] of this.#localCopies) {
      if (listed.has(id) || seq > since) {
        this.#localCopies.delete(id);
        continue;
      }
      merged.push(instance);
    }

    return merged;
  };
}
