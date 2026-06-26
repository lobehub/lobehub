import { BRANDING_NAME } from '@lobechat/business-const';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type * as ReactModule from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DynamicRouteMeta, DynamicRouteMetaProps } from '@/spa/router/routeMeta';

import RouteMetaBridge from './RouteMetaBridge';
import { usePublishDynamicRouteMeta } from './usePublishDynamicRouteMeta';

const mocks = vi.hoisted(() => {
  interface MockMatch {
    data: unknown;
    handle: unknown;
    id: string;
    params: Record<string, string | undefined>;
    pathname: string;
    search?: string;
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

const createDynamicMeta = (
  resolve: (params: Record<string, string | undefined>) => DynamicRouteMeta,
) => {
  const TestDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
    usePublishDynamicRouteMeta(resolve(params), onResolve);

    return null;
  };

  return TestDynamicMeta;
};

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

vi.mock('react-router', async () => {
  const React = await vi.importActual<typeof ReactModule>('react');

  return {
    useMatches: () => React.useSyncExternalStore(mocks.subscribe, mocks.getSnapshot),
    useLocation: () => {
      const matches = React.useSyncExternalStore(mocks.subscribe, mocks.getSnapshot);
      const match = matches.at(-1);
      return { pathname: match?.pathname ?? '/', search: match?.search ?? '' };
    },
  };
});

describe('RouteMetaBridge', () => {
  const ChatDynamicMeta = createDynamicMeta(() => ({ title: 'Chat A' }));
  const TopicDynamicMeta = createDynamicMeta((params) => ({
    title: `Topic ${params.topicId ?? params.topic}`,
  }));

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
            DynamicMeta: ChatDynamicMeta,
            titleKey: 'navigation.chat',
          },
        },
        id: 'routes/agent',
        params: { aid: 'agent-a' },
        pathname: '/agent/agent-a',
      },
    ]);

    render(<RouteMetaBridge />);

    await waitFor(
      () => {
        expect(document.title).toBe(`Chat A · ${BRANDING_NAME}`);
        expect(mocks.setCurrentRouteMeta).toHaveBeenLastCalledWith(
          {
            avatar: undefined,
            backgroundColor: undefined,
            title: 'Chat A',
          },
          '/agent/agent-a',
        );
      },
      { timeout: 2000 },
    );

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

  it('keeps the previous title when switching params within the same route', async () => {
    const titleSets: string[] = [];
    const titleDescriptor = Object.getOwnPropertyDescriptor(document, 'title');
    let titleStore = '';
    Object.defineProperty(document, 'title', {
      configurable: true,
      get: () => titleStore,
      set: (value: string) => {
        titleStore = value;
        titleSets.push(value);
      },
    });

    try {
      const makeMatch = (topicId: string) => ({
        data: undefined,
        handle: {
          meta: {
            DynamicMeta: TopicDynamicMeta,
            titleKey: 'navigation.chat',
          },
        },
        id: 'routes/agent',
        params: { topicId },
        pathname: `/agent/${topicId}`,
      });

      mocks.setMatches([makeMatch('a')]);
      render(<RouteMetaBridge />);

      await waitFor(() => {
        expect(document.title).toBe(`Topic a · ${BRANDING_NAME}`);
      });

      titleSets.length = 0;

      act(() => {
        mocks.setMatches([makeMatch('b')]);
      });

      await waitFor(() => {
        expect(document.title).toBe(`Topic b · ${BRANDING_NAME}`);
      });

      expect(titleSets).not.toContain(`translated:navigation.chat · ${BRANDING_NAME}`);
    } finally {
      if (titleDescriptor) Object.defineProperty(document, 'title', titleDescriptor);
    }
  });

  it('passes search params to dynamic route meta', async () => {
    mocks.setMatches([
      {
        data: undefined,
        handle: {
          meta: {
            DynamicMeta: TopicDynamicMeta,
            titleKey: 'navigation.groupChat',
          },
        },
        id: 'routes/group',
        params: { gid: 'group-a' },
        pathname: '/group/group-a',
        search: '?topic=t1',
      },
    ]);

    render(<RouteMetaBridge />);

    await waitFor(() => {
      expect(document.title).toBe(`Topic t1 · ${BRANDING_NAME}`);
      expect(mocks.setCurrentRouteMeta).toHaveBeenLastCalledWith(
        {
          avatar: undefined,
          backgroundColor: undefined,
          title: 'Topic t1',
        },
        '/group/group-a?topic=t1',
      );
    });
  });

  it('publishes empty dynamic meta for a static route without DynamicMeta', async () => {
    mocks.setMatches([
      {
        data: undefined,
        handle: { meta: { titleKey: 'navigation.settings' } },
        id: 'routes/settings',
        params: {},
        pathname: '/settings',
      },
    ]);

    render(<RouteMetaBridge />);

    await waitFor(() => {
      expect(document.title).toBe(`translated:navigation.settings · ${BRANDING_NAME}`);
      expect(mocks.setCurrentRouteMeta).toHaveBeenLastCalledWith({}, '/settings');
    });
  });
});
