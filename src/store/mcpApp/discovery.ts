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
export const refreshMcpAppDiscovery = (key: string, run: () => Promise<unknown>) => {
  const config = getServerConfigStoreState();
  if (!config || !serverConfigSelectors.enableMcpApps(config)) return;
  if (useMcpAppStore.getState().discoveryAttempts[key]) return;
  const attempt = ++sequence;
  useMcpAppStore.setState(
    (s) => ({ discoveryAttempts: { ...s.discoveryAttempts, [key]: attempt } }),
    false,
    'mcpApp/discoveryAttempt',
  );
  pending.push(async () => {
    const currentConfig = getServerConfigStoreState();
    // A logout/reset or disabled feature must not start queued work for the old user.
    if (
      useMcpAppStore.getState().discoveryAttempts[key] !== attempt ||
      !currentConfig ||
      !serverConfigSelectors.enableMcpApps(currentConfig)
    )
      return;
    try {
      await run();
    } catch (error) {
      console.warn('[MCPApp] entrypoint discovery refresh failed', error);
    }
  });
  drain();
};
