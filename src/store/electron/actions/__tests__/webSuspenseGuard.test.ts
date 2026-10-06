import { renderHook, waitFor } from '@testing-library/react';
import { Component, createElement, type ReactNode, Suspense } from 'react';
import { SWRConfig } from 'swr';
import { describe, expect, it } from 'vitest';

import { type ElectronStore, useElectronStore } from '@/store/electron';

/**
 * Regression: on web (non-desktop) these SWR hooks used to call the Electron
 * IPC unconditionally. The fetch always rejected with "electronAPI.invoke not
 * found", which was silent until layouts adopted `SWRConfig { suspense: true }`
 * — then the rejection was thrown during render and the route boundary
 * replaced the whole page with a load-failure screen (/settings/devices,
 * /settings/proxy). The keys must be null off-desktop so no fetch starts.
 */

class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    return this.state.error ? `boundary: ${this.state.error.message}` : this.props.children;
  }
}

const desktopOnlySwrHooks = [
  'useFetchGatewayDeviceInfo',
  'useFetchGatewayStatus',
  'useFetchDesktopHotkeys',
  'useGetProxySettings',
  'useDataSyncConfig',
] as const;

describe('desktop-only SWR hooks under a suspense SWRConfig on web', () => {
  it.each(desktopOnlySwrHooks)('%s neither fetches nor throws', async (hookName) => {
    const rendered: string[] = [];

    renderHook(
      () => {
        const useHook = useElectronStore((s) => s[hookName] as ElectronStore[typeof hookName]);
        useHook();
        rendered.push(hookName);
      },
      {
        wrapper: ({ children }) =>
          createElement(
            SWRConfig,
            { value: { provider: () => new Map(), suspense: true } },
            createElement(Boundary, undefined, createElement(Suspense, undefined, children)),
          ),
      },
    );

    // Before the fix the hook suspended on the doomed IPC fetch, the rejection
    // hit the boundary, and the hook body never (re)rendered to completion.
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  });
});
