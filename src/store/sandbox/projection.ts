import type { EnvironmentKind, EnvironmentVisibility } from '@lobechat/types';

import { arrayEntity, defineReplica, type ReplicaEntityAdapter } from '@/libs/replica';
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
 * The cloud-sandbox reads the composer's instance chip, its picker, the
 * environments page and the working panel's Files tab paint from. Replicas, so
 * a reload paints the last confirmed answer on the first frames and the network
 * only confirms it.
 *
 * Every persisted value is a slim projection: an environment's configuration
 * carries `env` and source URLs (a URL can carry a token), and an instance row
 * carries build logs, so neither reaches storage — only the fields these
 * surfaces read.
 * Rows are partitioned by the cache scope (user + workspace), which is also the
 * dimension the server answers the entitlement and both lists from.
 */

/** The single entry of the scope-wide reads (entitlement and the instance list). */
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

/**
 * Which pool of environments a list answers: `all` on the personal page and in
 * the composer's picker, `public` / `private` on the workspace page's two tabs.
 * The server answers each pool with its own query, so each is its own entry.
 */
export type SandboxEnvironmentPool = EnvironmentVisibility | 'all';

export const toEnvironmentPool = (visibility?: EnvironmentVisibility): SandboxEnvironmentPool =>
  visibility ?? 'all';

/** A GitHub checkout URL as `owner/name`, or nothing for any other URL. */
const GITHUB_REPOSITORY = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/;

const githubRepository = (configuration: RawEnvironment['configuration']): string | undefined => {
  const sources = (configuration as { sources?: { kind?: string; url?: string }[] } | null)
    ?.sources;
  const url = sources?.find((source) => source.kind === 'git')?.url;

  return url ? GITHUB_REPOSITORY.exec(url)?.[1] : undefined;
};

/**
 * One environment as the environments page and the composer's picker read it.
 *
 * `configuration` lives in memory only: it carries `env` (credentials) and
 * source URLs (a URL can carry a token), so it never reaches storage. A row
 * restored from storage has none; `repository` is the one fact of it a row
 * shows, kept only when it is a plain GitHub `owner/name`.
 */
export interface SandboxEnvironment {
  /** Absent on a row restored from storage, until the server answers again. */
  configuration?: RawEnvironment['configuration'];
  createdAt: string;
  creator: {
    avatar: string | null;
    fullName: string | null;
    id: string | null;
    username: string | null;
  } | null;
  description: string | null;
  id: string;
  /** Every environment is a code environment now; kept for the picker's shape. */
  kind: EnvironmentKind;
  name: string;
  repository?: string;
  userId: string;
  visibility: RawEnvironment['visibility'];
  workspaceId: string | null;
}

export const toSandboxEnvironment = (environment: RawEnvironment): SandboxEnvironment => ({
  configuration: environment.configuration,
  createdAt: new Date(environment.createdAt).toISOString(),
  creator: environment.creator
    ? {
        avatar: environment.creator.avatar ?? null,
        fullName: environment.creator.fullName ?? null,
        id: environment.creator.id,
        username: environment.creator.username ?? null,
      }
    : null,
  description: environment.description ?? null,
  id: environment.id,
  kind: 'code',
  name: environment.name,
  repository: githubRepository(environment.configuration),
  userId: environment.userId,
  visibility: environment.visibility,
  workspaceId: environment.workspaceId ?? null,
});

/** What reaches storage of a list: every row without its configuration. */
export const toPersistedEnvironments = (environments: SandboxEnvironment[]): SandboxEnvironment[] =>
  environments.map(({ configuration: _configuration, ...row }) => row);

/** What the composer's picker reads of an environment, and nothing more. */
export type SandboxPickerEnvironment = Pick<
  SandboxEnvironment,
  'id' | 'kind' | 'name' | 'userId' | 'visibility' | 'workspaceId'
>;

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

/** Environment rows are addressed by the environment id, in every pool. */
export const sandboxEnvironmentEntity: ReplicaEntityAdapter<
  SandboxEnvironment[],
  SandboxEnvironment
> = arrayEntity<SandboxEnvironment>((environment) => environment.id);

/**
 * Every pool's environments. The environments page and the composer's picker
 * read the same `all` entry, so the personal page and the picker share one
 * request and one stored row.
 */
export const sandboxEnvironmentsResource = defineReplica<
  SandboxEnvironmentPool,
  SandboxEnvironment[]
>({
  key: (pool) => pool,
  name: 'sandboxEnvironments',
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
