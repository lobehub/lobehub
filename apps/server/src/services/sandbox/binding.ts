/**
 * Where a drive's instances live, in the vocabulary `environment_instances`
 * uses for every execution target it supports.
 *
 * The scope is the drive's storage key and the resource is the one persistent
 * volume inside it — there is exactly one, which is why the resource is named
 * rather than identified. What distinguishes two instances is the directory,
 * and `environment_instances_provider_path_unique` covers that tuple, so the
 * database is what stops two copies landing in one folder.
 */
export const sandboxStorageBinding = (storageKey: string) => ({
  deviceId: null,
  kind: 'sandbox' as const,
  provider: 'market',
  providerResourceId: 'workspace',
  providerScope: storageKey,
});

/** Whether `path` is `directory` itself or somewhere beneath it. */
export const isPathWithin = (path: string, directory: string) =>
  path === directory || path.startsWith(`${directory}/`);
