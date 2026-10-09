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
  fetchConnectors()
    .catch((error) => {
      console.error('[SPA Initialize] fetchConnectors failed', error);
    })
    .finally(() => {
      connectorsFetching = false;
    });
};

export const startConnectorInitialization = () => {
  if (connectorsStarted) return;
  connectorsStarted = true;

  ensureConnectors();
  useUserStore.subscribe(ensureConnectors);
  useToolStore.subscribe(ensureConnectors);
};
