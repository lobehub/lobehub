/**
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import TopicsSkeleton from '@/components/Skeleton/Topics';
import { routeMeta } from '@/spa/router/routeMeta';

import { resolveRouteSkeleton, usePreloadRouteSkeleton } from './useRouteSkeleton';

describe('resolveRouteSkeleton', () => {
  it('returns the deepest match that declares a skeleton', () => {
    const Skeleton = resolveRouteSkeleton([
      { handle: { meta: routeMeta({ titleKey: 'navigation.chat' }) } },
      { handle: { meta: routeMeta({ Skeleton: TopicsSkeleton, titleKey: 'navigation.topics' }) } },
    ]);

    expect(Skeleton).toBe(TopicsSkeleton);
  });

  it('skips matches without a skeleton and uses the nearest ancestor', () => {
    const Skeleton = resolveRouteSkeleton([
      { handle: { meta: routeMeta({ Skeleton: TopicsSkeleton, titleKey: 'navigation.topics' }) } },
      { handle: { meta: routeMeta({ titleKey: 'navigation.permission' }) } },
    ]);

    expect(Skeleton).toBe(TopicsSkeleton);
  });

  it('returns undefined when no match declares a skeleton', () => {
    expect(
      resolveRouteSkeleton([{ handle: { meta: routeMeta({ titleKey: 'navigation.chat' }) } }]),
    ).toBeUndefined();
  });
});

describe('usePreloadRouteSkeleton', () => {
  it('starts loading the matched route skeleton before any fallback renders it', async () => {
    const preload = vi.fn(async () => {});
    const Skeleton = Object.assign(() => null, { preload });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(RouterProvider, {
        router: createMemoryRouter(
          [
            {
              element: children,
              handle: { meta: routeMeta({ Skeleton }) },
              path: '/resource/files',
            },
          ],
          { initialEntries: ['/resource/files'] },
        ),
      });

    renderHook(() => usePreloadRouteSkeleton(), { wrapper });

    await waitFor(() => expect(preload).toHaveBeenCalledTimes(1));
  });
});
