/**
 * SWR keys of the Linear integration. Kept beside the feature because the
 * central registry (`@/libs/swr/keys`) is over the file-size limit; they
 * follow its `'<domain>:<resource>'` convention.
 */
export const linearKeys = {
  config: () => ['linear:config'] as const,
  connections: (workspaceId: string | null | undefined) =>
    ['linear:connections', workspaceId ?? null] as const,
};
