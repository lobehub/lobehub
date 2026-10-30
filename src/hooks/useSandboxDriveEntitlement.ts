import { sandboxActions, sandboxSelectors, useSandboxStore } from '@/store/sandbox';

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
  // The replica entry the composer chip and the environments page read, so a
  // reload paints the storage page from the last answer and every surface
  // agrees on it.
  const { error, isHydrated, isValidating, revalidate } = sandboxActions.useFetchEntitlement(enabled, {
    revalidateOnFocus: false,
  });
  const data = useSandboxStore(sandboxSelectors.entitlement);

  return {
    entitled: data?.entitled,
    error: error as Error | undefined,
    // Loading only until there is something to show: a cached answer paints
    // at once and the revalidation behind it never blanks the page.
    isLoading: data === undefined && (!isHydrated || isValidating),
    quotaBytes: data?.quotaBytes ?? null,
    retry: () => void revalidate(),
  };
};
