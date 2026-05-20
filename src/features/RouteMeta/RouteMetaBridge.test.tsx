import { BRANDING_NAME } from '@lobechat/business-const';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type * as ReactModule from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RouteMetaBridge from './RouteMetaBridge';

const mocks = vi.hoisted(() => {
  interface MockMatch {
    data: unknown;
    handle: unknown;
    id: string;
    params: Record<string, string | undefined>;
    pathname: string;
  }

  const store = {
    listeners: new Set<() => void>(),
    matches: [] as MockMatch[],
    setMatches: (matches: MockMatch[]) => {
      store.matches = matches;
      for (const listener of store.listeners) {
        listener();
      }
    },
  };

  return {
    getSnapshot: () => store.matches,
    setCurrentRouteMeta: vi.fn(),
    setMatches: store.setMatches,
    subscribe: (listener: () => void) => {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
  };
});

vi.mock('@/const/version', () => ({
  isDesktop: true,
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (
    selector: (state: { setCurrentRouteMeta: typeof mocks.setCurrentRouteMeta }) => unknown,
  ) => selector({ setCurrentRouteMeta: mocks.setCurrentRouteMeta }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `translated:${key}` }),
}));

vi.mock('react-router-dom', async () => {
  const React = await vi.importActual<typeof ReactModule>('react');

  return {
    useMatches: () => React.useSyncExternalStore(mocks.subscribe, mocks.getSnapshot),
    useLocation: () => {
      const matches = React.useSyncExternalStore(mocks.subscribe, mocks.getSnapshot);
      return { pathname: matches.at(-1)?.pathname ?? '/', search: '' };
    },
  };
});

describe('RouteMetaBridge', () => {
  const resolveDynamicMeta = () => ({ title: 'Chat A' });

  afterEach(() => {
    cleanup();
    document.title = '';
    mocks.setMatches([]);
    mocks.setCurrentRouteMeta.mockReset();
  });

  it('clears dynamic meta when the matched route has no route meta handle', async () => {
    mocks.setMatches([
      {
        data: undefined,
        handle: {
          meta: {
            titleKey: 'navigation.chat',
            useDynamicMeta: resolveDynamicMeta,
          },
        },
        id: 'routes/agent',
        params: { aid: 'agent-a' },
        pathname: '/agent/agent-a',
      },
    ]);

    render(<RouteMetaBridge />);

    await waitFor(() => {
      expect(document.title).toBe(`Chat A · ${BRANDING_NAME}`);
      expect(mocks.setCurrentRouteMeta).toHaveBeenLastCalledWith(
        {
          avatar: undefined,
          backgroundColor: undefined,
          title: 'Chat A',
        },
        '/agent/agent-a',
      );
    });

    act(() => {
      mocks.setMatches([
        {
          data: undefined,
          handle: undefined,
          id: 'routes/agent-profile',
          params: { aid: 'agent-a' },
          pathname: '/agent/agent-a/profile',
        },
      ]);
    });

    await waitFor(() => {
      expect(document.title).toBe(BRANDING_NAME);
      expect(mocks.setCurrentRouteMeta).toHaveBeenLastCalledWith(null);
    });
  });
});
