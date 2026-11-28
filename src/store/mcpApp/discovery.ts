import { getServerConfigStoreState, serverConfigSelectors } from '@/store/serverConfig';

import { useMcpAppStore } from './store';

let sequence = 0;
let running = 0;
const pending: (() => Promise<void>)[] = [];
const drain = () => {
  while (running < 2 && pending.length) {
    const task = pending.shift()!;
    running++;
    void task().finally(() => {
      running--;
      drain();
    });
  }
};

/** One compatibility refresh per user session, shared across sidebar mounts. */
export const refreshMcpAppDiscovery = (
  key: string,
  run: (isCurrent: () => boolean) => Promise<unknown>,
) => {
  const config = getServerConfigStoreState();
  if (!config || !serverConfigSelectors.enableMcpApps(config)) return;
  if (useMcpAppStore.getState().discoveryAttempts[key]) return;
  const attempt = ++sequence;
  useMcpAppStore.setState(
    (s) => ({ discoveryAttempts: { ...s.discoveryAttempts, [key]: attempt } }),
    false,
    'mcpApp/discoveryAttempt',
  );
  const isCurrent = () => {
    const currentConfig = getServerConfigStoreState();
    return (
      useMcpAppStore.getState().discoveryAttempts[key] === attempt &&
      !!currentConfig &&
      serverConfigSelectors.enableMcpApps(currentConfig)
    );
  };
  pending.push(async () => {
    // A logout/reset or disabled feature must not start queued work for the old user.
    if (!isCurrent()) return;
    try {
      await run(isCurrent);
    } catch (error) {
      console.warn('[MCPApp] entrypoint discovery refresh failed', error);
    }
  });
  drain();
};
