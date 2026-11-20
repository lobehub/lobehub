import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCollectionItems } from './useCollectionItems';

const mocks = vi.hoisted(() => ({
  revalidate: vi.fn(),
  useFetchWorkVersions: vi.fn(),
}));

const store = vi.hoisted(() => ({ current: undefined as any }));

vi.mock('@/store/work', async () => {
  const { create: createStore } = await import('zustand');
  store.current = createStore<{ workVersionsMap: Record<string, unknown[]> }>(() => ({
    workVersionsMap: {},
  }));
  return {
    useWorkStore: store.current,
    workActions: { useFetchWorkVersions: mocks.useFetchWorkVersions },
    workSelectors: {
      workVersions: (workId: string) => (s: any) => s.workVersionsMap[workId],
    },
  };
});

const image = (n: number) => ({ fileId: `file-${n}`, url: `https://app.example.com/f/file-${n}` });
const version = (...images: ReturnType<typeof image>[]) => ({
  metadata: { collection: { items: images } },
});

describe('useCollectionItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.current.setState({ workVersionsMap: {} });
    mocks.useFetchWorkVersions.mockReturnValue({ error: undefined, revalidate: mocks.revalidate });
  });

  it('shows the images it is given without loading the versions', () => {
    const { result } = renderHook(() =>
      useCollectionItems({ items: [image(1), image(2)], workId: 'work-1' }),
    );

    expect(result.current).toMatchObject({ images: [image(1), image(2)], isLoading: false });
    expect(mocks.useFetchWorkVersions).toHaveBeenCalledWith(null, expect.anything());
  });

  it('shows the latest version and follows a refresh of the Work versions', () => {
    // Versions come newest first.
    store.current.setState({
      workVersionsMap: { 'work-c': [version(image(3)), version(image(1))] },
    });

    const { result } = renderHook(() => useCollectionItems({ workId: 'work-c' }));

    expect(mocks.useFetchWorkVersions).toHaveBeenCalledWith(
      { workId: 'work-c' },
      expect.anything(),
    );
    expect(result.current.images).toEqual([image(3)]);

    // The agent replaced the images; the run-end refresh lands a new version.
    act(() => {
      store.current.setState({
        workVersionsMap: { 'work-c': [version(image(4), image(5)), version(image(3))] },
      });
    });
    expect(result.current.images).toEqual([image(4), image(5)]);
  });

  it('is loading until the versions arrive', () => {
    const { result } = renderHook(() => useCollectionItems({ workId: 'work-pending' }));

    expect(result.current).toMatchObject({ images: undefined, isLoading: true });
  });
});
