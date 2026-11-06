import { afterEach, describe, expect, it } from 'vitest';

import { getToolStoreState, useToolStore } from '@/store/tool';

import { mcpAppNameSelector } from './appName';

const initialState = useToolStore.getState();

afterEach(() => {
  useToolStore.setState(initialState, true);
});

// The name a view's follow-up message and its confirm modals show
describe('mcpAppNameSelector', () => {
  it("names a plugin's view by the plugin's display name", () => {
    useToolStore.setState({
      installedPlugins: [
        {
          identifier: 'weather-demo',
          manifest: { api: [], identifier: 'weather-demo', meta: { title: 'Weather Demo' } },
          type: 'customPlugin',
        },
      ] as any,
    });

    expect(mcpAppNameSelector('weather-demo')(getToolStoreState())).toBe('Weather Demo');
  });

  it("names a connector's view by the connector name", () => {
    useToolStore.setState({ connectors: [{ identifier: 'linear-abc', name: 'Linear' }] as any });

    expect(mcpAppNameSelector('linear-abc')(getToolStoreState())).toBe('Linear');
  });

  it('falls back to the identifier once the app is gone', () => {
    expect(mcpAppNameSelector('removed-app')(getToolStoreState())).toBe('removed-app');
  });
});
