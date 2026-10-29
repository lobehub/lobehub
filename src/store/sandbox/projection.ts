import type { EnvironmentKind } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';
import type { environmentService } from '@/services/environment';
import type { sandboxStorageService } from '@/services/sandboxStorage';

type RawEnvironment = Awaited<
  ReturnType<typeof environmentService.listEnvironments>
>['environments'][number];
type RawInstance = Awaited<
  ReturnType<typeof sandboxStorageService.listInstances>
>['instances'][number];
type RawEntitlement = Awaited<ReturnType<typeof sandboxStorageService.getEntitlement>>;
type RawInstanceDetail = Awaited<ReturnType<typeof sandboxStorageService.getInstance>>;

/**
 * The cloud-sandbox reads the composer's instance chip, its picker and the
 * working panel's Files tab paint from. Replicas, so a reload paints the last
 * confirmed answer on the first frames and the network only confirms it.
 *
 * Every value is a slim projection: an environment's configuration carries
 * `env` and source URLs (a URL can carry a token), and an instance row carries
 * build logs, so neither reaches storage — only the fields these surfaces read.
 * Rows are partitioned by the cache scope (user + workspace), which is also the
 * dimension the server answers the entitlement and both lists from.
 */

/** The single entry of the scope-wide reads (entitlement and both lists). */
export const SANDBOX_SCOPE_ENTRY = 'current';
export type SandboxScopeEntry = typeof SANDBOX_SCOPE_ENTRY;

/**
 * `{ entitled, quotaBytes }`. Gates the composer's chip and the environments
 * page; the server still resolves the claim on every sandbox call, so a stale
 * answer only shapes what is shown until the revalidation lands.
 */
export interface SandboxEntitlement {
  entitled: boolean;
  quotaBytes: number | null;
}

export const toSandboxEntitlement = (raw: RawEntitlement): SandboxEntitlement => ({
  entitled: raw.entitled,
  quotaBytes: raw.quotaBytes ?? null,
});

/** What the composer's picker reads of an environment, and nothing more. */
export interface SandboxPickerEnvironment {
  id: string;
  /** Derived from the configuration at the boundary; the configuration is not kept. */
  kind: EnvironmentKind;
  name: string;
  userId: string;
  visibility: RawEnvironment['visibility'];
  workspaceId: string | null;
}

export const toPickerEnvironment = (environment: RawEnvironment): SandboxPickerEnvironment => ({
  id: environment.id,
  // Every environment is a code environment now; the field stays so the
  // picker's shape does not change under the persisted replica rows.
  kind: 'code',
  name: environment.name,
  userId: environment.userId,
  visibility: environment.visibility,
  workspaceId: environment.workspaceId ?? null,
});

/** A listed copy, as the picker renders it. */
export interface SandboxPickerInstance {
  createdAt: string;
  environmentId: string;
  id: string;
  inUse: boolean;
  inUseByThisTopic: boolean;
  isDefault: boolean;
  name: string;
  status: RawInstance['status'];
  workingDirectory: string;
}

/**
 * The instance list and the conversation its occupancy was answered for.
 *
 * One entry for the whole scope rather than one per topic: the copies are the
 * same list from every conversation, and only `inUseByThisTopic` depends on the
 * asking topic. Keyed per topic, every conversation visited would persist its
 * own full copy of the list. The selector reads `inUseByThisTopic` only when
 * `topicId` is the conversation on screen.
 */
export interface SandboxPickerInstanceList {
  instances: SandboxPickerInstance[];
  /** The topic `inUseByThisTopic` was answered for; `null` before the first send. */
  topicId: string | null;
}

export const toPickerInstance = (
  instance: Pick<
    RawInstance,
    | 'createdAt'
    | 'environmentId'
    | 'id'
    | 'inUse'
    | 'inUseByThisTopic'
    | 'isDefault'
    | 'name'
    | 'status'
    | 'workingDirectory'
  >,
): SandboxPickerInstance => ({
  createdAt: new Date(instance.createdAt).toISOString(),
  environmentId: instance.environmentId,
  id: instance.id,
  inUse: instance.inUse,
  inUseByThisTopic: instance.inUseByThisTopic,
  isDefault: instance.isDefault,
  name: instance.name,
  status: instance.status,
  workingDirectory: instance.workingDirectory,
});

/**
 * Where a bound instance's files live: all the working panel reads of it.
 * `workingDirectory: null` is the server's "this instance is gone" — a value the
 * panel settles on, never persisted.
 */
export interface SandboxInstanceDirectory {
  workingDirectory: string | null;
}

export const toInstanceDirectory = (instance: RawInstanceDetail): SandboxInstanceDirectory => ({
  workingDirectory: instance ? instance.workingDirectory : null,
});

export interface SandboxInstancesParams {
  /** Topic whose occupancy the listing answers; absent before the first send. */
  topicId?: string;
}

export const sandboxEntitlementResource = defineReplica<SandboxScopeEntry, SandboxEntitlement>({
  key: (entry) => entry,
  name: 'sandboxEntitlement',
  storage: 'indexedDB',
  version: 1,
});

export const sandboxEnvironmentsResource = defineReplica<
  SandboxScopeEntry,
  SandboxPickerEnvironment[]
>({
  key: (entry) => entry,
  name: 'sandboxPickerEnvironments',
  storage: 'indexedDB',
  version: 1,
});

/**
 * Keyed by the scope alone (see {@link SandboxPickerInstanceList}); the sync key
 * still carries the topic, so moving to another conversation re-asks the
 * server for that conversation's occupancy.
 */
export const sandboxInstancesResource = defineReplica<
  SandboxInstancesParams,
  SandboxPickerInstanceList
>({
  key: () => SANDBOX_SCOPE_ENTRY,
  name: 'sandboxPickerInstances',
  storage: 'indexedDB',
  version: 1,
});

/** Instances a user binds conversations to; old ones fall out of storage only. */
const MAX_PERSISTED_INSTANCE_DIRECTORIES = 20;

export const sandboxInstanceDirectoryResource = defineReplica<string, SandboxInstanceDirectory>({
  key: (instanceId) => instanceId,
  name: 'sandboxInstanceDirectory',
  persist: { maxEntries: MAX_PERSISTED_INSTANCE_DIRECTORIES },
  storage: 'indexedDB',
  version: 1,
});
