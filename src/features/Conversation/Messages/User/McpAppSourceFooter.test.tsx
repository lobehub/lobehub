/**
 * @vitest-environment happy-dom
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useToolStore } from '@/store/tool';

import McpAppSourceFooter from './McpAppSourceFooter';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    t: (key: string, options?: { app?: string }) => `${key}:${options?.app}`,
  }),
}));

const initialState = useToolStore.getState();

afterEach(() => {
  act(() => useToolStore.setState(initialState, true));
});

describe('McpAppSourceFooter', () => {
  it('marks the message as a follow-up from the plugin, by its display name', () => {
    act(() =>
      useToolStore.setState({
        installedPlugins: [
          {
            identifier: 'weather-demo',
            manifest: {
              api: [],
              identifier: 'weather-demo',
              meta: { title: 'Weather Demo' },
            },
            type: 'customPlugin',
          },
        ] as any,
      }),
    );

    render(<McpAppSourceFooter source={{ identifier: 'weather-demo' }} />);

    expect(screen.getByText('mcpApp.message.source:Weather Demo')).toBeTruthy();
  });

  it('names a connector view by the connector name', () => {
    act(() =>
      useToolStore.setState({
        connectors: [{ identifier: 'linear-abc', name: 'Linear' }] as any,
      }),
    );

    render(<McpAppSourceFooter source={{ identifier: 'linear-abc' }} />);

    expect(screen.getByText('mcpApp.message.source:Linear')).toBeTruthy();
  });

  it('falls back to the identifier once the app is gone', () => {
    render(<McpAppSourceFooter source={{ identifier: 'removed-app' }} />);

    expect(screen.getByText('mcpApp.message.source:removed-app')).toBeTruthy();
  });
});
