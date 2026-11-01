import { getCacheScope } from '@/libs/swr/useCacheScope';
import { getToolStoreState, useToolStore } from '@/store/tool';
import { getUserStoreState, useUserStore } from '@/store/user';

let connectorsStarted = false;
let connectorsFetching = false;

const ensureConnectors = () => {
  const { isSignedIn } = getUserStoreState();
  const { fetchConnectors, isConnectorsInit } = getToolStoreState();

  if (!isSignedIn || isConnectorsInit || connectorsFetching) return;

  // Claim the slot BEFORE calling: `fetchConnectors()` is subscribed to the
  // tool store, so any state it commits in its synchronous prefix would
  // re-enter this very function while the guard is still unset and launch a
  // duplicate list request.
  connectorsFetching = true;
  const scope = getCacheScope();
  fetchConnectors()
    .catch((error) => {
      console.error('[SPA Initialize] fetchConnectors failed', error);
    })
    .finally(() => {
      connectorsFetching = false;
      // A scope switch during the request re-arms the init gate (the slice
      // drops the previous identity's views on the change), but its re-entrant
      // call here was swallowed by the in-flight slot — and the response this
      // request is waiting for belongs to the old scope, so it will be
      // discarded. Re-check now that the slot is free, otherwise the new scope
      // waits for an unrelated store update to get its own list.
      //
      // Keyed on the scope moving, not on the gate alone: a *failed* fetch also
      // leaves the gate unset, and retrying that here would spin.
      if (getCacheScope() !== scope) ensureConnectors();
    });
};

export const startConnectorInitialization = () => {
  if (connectorsStarted) return;
  connectorsStarted = true;

  ensureConnectors();
  useUserStore.subscribe(ensureConnectors);
  useToolStore.subscribe(ensureConnectors);
};
