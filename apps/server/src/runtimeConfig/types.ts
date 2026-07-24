import type { ZodSchema } from 'zod';

export interface RuntimeConfigGlobalSelector {
  scope: 'global';
}

export interface RuntimeConfigUserSelector {
  id: string;
  scope: 'user';
}

export type RuntimeConfigSelector = RuntimeConfigGlobalSelector | RuntimeConfigUserSelector;

export interface VersionedSnapshot<T> {
  data: T;
  updatedAt: string;
  version: number;
}

export interface RuntimeConfigDomain<T> {
  /**
   * Whether a missing snapshot should be cached. Disable this for sparse,
   * dynamically-created selector data where a later write must be visible
   * immediately (for example, per-user feature-flag overrides).
   */
  cacheNullSnapshots?: boolean;
  cacheTtlMs: number;
  getStorageKey: (selector?: RuntimeConfigSelector) => string;
  getVersionKey?: (selector?: RuntimeConfigSelector) => string;
  key: string;
  schema: ZodSchema<T>;
}

export interface RuntimeConfigProvider<T> {
  domain: RuntimeConfigDomain<T>;
  getSnapshot: (selector?: RuntimeConfigSelector) => Promise<VersionedSnapshot<T> | null>;
  isEnabled: () => boolean;
}
