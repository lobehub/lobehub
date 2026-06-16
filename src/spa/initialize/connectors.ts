import { getToolStoreState, useToolStore } from '@/store/tool';
import { getUserStoreState, useUserStore } from '@/store/user';

let connectorsStarted = false;
let pendingFetch: Promise<void> | undefined;

const ensureConnectors = () => {
  const { isSignedIn } = getUserStoreState();
  const { fetchConnectors, isConnectorsInit } = getToolStoreState();

  if (!isSignedIn || isConnectorsInit || pendingFetch) return;

  pendingFetch = fetchConnectors()
    .catch((error) => {
      console.error('[SPA Initialize] fetchConnectors failed', error);
    })
    .finally(() => {
      pendingFetch = undefined;
    });
};

export const startConnectorInitialization = () => {
  if (connectorsStarted) return;
  connectorsStarted = true;

  ensureConnectors();
  useUserStore.subscribe(ensureConnectors);
  useToolStore.subscribe(ensureConnectors);
};
