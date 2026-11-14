import { defineReplica } from '@/libs/replica';
import type { scmService } from '@/services/scm';

type Resolved<T extends (...args: any[]) => Promise<unknown>> = Awaited<ReturnType<T>>;

export type ScmConfig = Resolved<typeof scmService.getConfig>;
export type ScmIdentity = NonNullable<Resolved<typeof scmService.getIdentity>>;
export type ScmInstallationItem = Resolved<typeof scmService.listInstallations>[number];

/**
 * The caller's GitHub identity, wrapped so "not connected" (`identity: null`)
 * is a value the local copy can replay, not an absence. Served without
 * credentials.
 */
export interface ScmIdentityEntry {
  identity: ScmIdentity | null;
}

/** Each integration read has one entry; the scope partitions it per user + workspace. */
export type IntegrationParams = Record<string, never>;
export const INTEGRATION_PARAMS: IntegrationParams = {};
export const INTEGRATION_KEY = 'github';

/** Whether this deployment runs the GitHub App, and where installs start. */
export const scmConfigResource = defineReplica<IntegrationParams, ScmConfig>({
  key: () => INTEGRATION_KEY,
  name: 'scmConfig',
  storage: 'indexedDB',
  version: 1,
});

export const scmIdentityResource = defineReplica<IntegrationParams, ScmIdentityEntry>({
  key: () => INTEGRATION_KEY,
  name: 'scmIdentity',
  storage: 'indexedDB',
  version: 1,
});

/** Live GitHub App installations bound to the active scope. */
export const scmInstallationsResource = defineReplica<IntegrationParams, ScmInstallationItem[]>({
  key: () => INTEGRATION_KEY,
  name: 'scmInstallations',
  storage: 'indexedDB',
  version: 1,
});
