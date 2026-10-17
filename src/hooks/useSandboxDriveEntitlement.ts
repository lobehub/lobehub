import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { sandboxStorageService } from '@/services/sandboxStorage';

/**
 * Whether this account has a network drive in the active workspace — the one
 * thing persistence in the cloud sandbox needs, and the one thing environment
 * definitions do not.
 *
 * Asked of the server rather than derived from a plan: the entitlement is
 * resolved and signed server-side, and asking is the only way to see the same
 * answer a sandbox run will act on. Keyed by workspace, because the server
 * resolves it from the active one — a single key would hand the previous
 * workspace's answer to the next one until a reload.
 *
 * `entitled` stays `undefined` until the answer arrives, so a caller can show
 * nothing rather than flash an upgrade prompt at an entitled account.
 */
export const useSandboxDriveEntitlement = (enabled = true) => {
  const workspaceId = useActiveWorkspaceId();
  const { data, error, isLoading, mutate } = useSWR(
    enabled ? ['sandbox-storage-entitlement', workspaceId ?? ''] : null,
    () => sandboxStorageService.getEntitlement(),
    { revalidateOnFocus: false },
  );

  return {
    entitled: data?.entitled,
    error: error as Error | undefined,
    isLoading,
    quotaBytes: data?.quotaBytes ?? null,
    retry: () => void mutate(),
  };
};
