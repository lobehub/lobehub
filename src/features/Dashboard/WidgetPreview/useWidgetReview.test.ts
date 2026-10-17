/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '@/store/dashboard';
import { initialState } from '@/store/dashboard/initialState';

import { useWidgetReview } from './useWidgetReview';

interface FakeResponse {
  data?: unknown;
  error?: unknown;
  isValidating?: boolean;
}

/**
 * Replica sync responses by resource name: `widgetDetail` / `widgetVersions` /
 * `widgetPreviewRun`. The store reaches them through `useSync`, so the mock
 * answers both the hydration read and the sync of each entry.
 */
const state = vi.hoisted(() => ({
  /** Per-resource revalidate spy: `useSync().mutate()` is what `retry` calls. */
  mutates: new Map<string, ReturnType<typeof vi.fn>>(),
  responses: new Map<string, FakeResponse>(),
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: (key: unknown[] | null) => {
    if (!key) return { data: undefined, isValidating: false, mutate: vi.fn() };
    // The persisted read completes, so the review is not stuck hydrating.
    if (key[0] === 'replica:hydrate') {
      return { data: true, isValidating: false, mutate: vi.fn() };
    }
    const name = key[1] as string;
    if (!state.mutates.has(name)) state.mutates.set(name, vi.fn());
    return {
      isValidating: false,
      mutate: state.mutates.get(name),
      ...state.responses.get(name),
    };
  },
}));

const widget = { draftVersionId: 'v2', id: 'w1', title: 'Open PRs' } as any;
const versions = [
  { id: 'v1', status: 'published', version: 1 },
  { id: 'v2', status: 'draft', version: 2 },
] as any[];

const respond = (resource: string, response: FakeResponse) =>
  state.responses.set(resource, response);

/** The replica projections a settled review reads, filled as `replace` would. */
const loadAll = (patch: Record<string, unknown> = {}) => {
  useDashboardStore.setState({
    widgetDetailMap: { w1: widget },
    widgetVersionsMap: { w1: versions },
    ...patch,
  });
};

beforeEach(() => {
  state.responses.clear();
  state.mutates.clear();
  vi.clearAllMocks();
  useDashboardStore.setState(initialState);
});

describe('useWidgetReview', () => {
  it('reports a failed load as an error, holds approval, and retries every request', () => {
    respond('widgetDetail', { error: new Error('500') });
    respond('widgetVersions', { data: versions });
    const onApprovalBlockedChange = vi.fn();

    const { result } = renderHook(() => useWidgetReview('w1', 'v2', { onApprovalBlockedChange }));

    expect(result.current.status).toBe('error');
    expect(result.current.error).toEqual(new Error('500'));
    expect(onApprovalBlockedChange).toHaveBeenLastCalledWith(true);

    act(() => result.current.retry());
    // Every review request is revalidated through its own replica slice.
    expect(state.mutates.get('widgetDetail')).toHaveBeenCalled();
    expect(state.mutates.get('widgetVersions')).toHaveBeenCalled();
  });

  it('holds approval while loading, including a retry in flight after a failure', () => {
    respond('widgetDetail', { error: new Error('500'), isValidating: true });
    respond('widgetVersions', { isValidating: true });
    const onApprovalBlockedChange = vi.fn();

    const { result } = renderHook(() => useWidgetReview('w1', 'v2', { onApprovalBlockedChange }));

    expect(result.current.status).toBe('loading');
    expect(onApprovalBlockedChange).toHaveBeenLastCalledWith(true);
  });

  it('releases approval once the pinned version is loaded', () => {
    loadAll();
    const onApprovalBlockedChange = vi.fn();

    const { result } = renderHook(() => useWidgetReview('w1', 'v2', { onApprovalBlockedChange }));

    expect(result.current.status).toBe('ready');
    expect(result.current.target).toMatchObject({ id: 'v2' });
    expect(onApprovalBlockedChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps approval held until the shown draft is pinned into the request', () => {
    loadAll();
    const onApprovalBlockedChange = vi.fn();
    const onPinVersion = vi.fn();

    const { result, rerender } = renderHook(
      ({ versionId }: { versionId?: string }) =>
        useWidgetReview('w1', versionId, { onApprovalBlockedChange, onPinVersion }),
      { initialProps: {} },
    );

    expect(result.current.status).toBe('pinning');
    expect(onPinVersion).toHaveBeenCalledWith('v2');
    expect(onApprovalBlockedChange).toHaveBeenLastCalledWith(true);

    rerender({ versionId: 'v2' });
    expect(result.current.status).toBe('ready');
    expect(onApprovalBlockedChange).toHaveBeenLastCalledWith(false);
  });

  it('holds approval when the requested version is not among the loaded ones', () => {
    loadAll();
    const onApprovalBlockedChange = vi.fn();

    const { result } = renderHook(() =>
      useWidgetReview('w1', 'v-gone', { onApprovalBlockedChange }),
    );

    expect(result.current.status).toBe('missing');
    expect(onApprovalBlockedChange).toHaveBeenLastCalledWith(true);
  });

  it('treats the preview run as part of the publish review', () => {
    loadAll();
    respond('widgetPreviewRun', { error: new Error('503') });
    const onApprovalBlockedChange = vi.fn();

    const { result } = renderHook(() =>
      useWidgetReview('w1', 'v2', { onApprovalBlockedChange, withRuns: true }),
    );

    expect(result.current.status).toBe('error');
    expect(onApprovalBlockedChange).toHaveBeenLastCalledWith(true);
    act(() => result.current.retry());
    expect(state.mutates.get('widgetPreviewRun')).toHaveBeenCalled();
  });

  it('loads the reviewed version’s preview by version, not the capped run list', () => {
    // The approval-era preview no longer sits in the newest-run window; only
    // the version-keyed entry can still see it.
    const run = { id: 'r1', versionId: 'v2' };
    loadAll({ widgetPreviewRunMap: { 'w1:v2': run } });
    const onApprovalBlockedChange = vi.fn();

    const { result } = renderHook(() =>
      useWidgetReview('w1', 'v2', { onApprovalBlockedChange, withRuns: true }),
    );

    expect(result.current.status).toBe('ready');
    expect(result.current.run).toEqual(run);
    // A proven preview means the publish it approves will not be refused.
    expect(onApprovalBlockedChange).toHaveBeenLastCalledWith(false);
  });

  it('holds approval when the reviewed version has no usable preview run', () => {
    // No usable dry run of v2 — the request settles on `null`, not an error:
    // publishing would be refused (DRY_RUN_REQUIRED), so the review renders its
    // warning and approval stays held.
    loadAll({ widgetPreviewRunMap: { 'w1:v2': null } });
    const onApprovalBlockedChange = vi.fn();

    const { result } = renderHook(() =>
      useWidgetReview('w1', 'v2', { onApprovalBlockedChange, withRuns: true }),
    );

    expect(result.current.status).toBe('ready');
    expect(result.current.run).toBeNull();
    expect(onApprovalBlockedChange).toHaveBeenLastCalledWith(true);
  });

  it('keeps a loaded review ready through a background revalidation failure', () => {
    loadAll();
    respond('widgetVersions', { error: new Error('500') });

    const { result } = renderHook(() => useWidgetReview('w1', 'v2'));

    expect(result.current.status).toBe('ready');
  });

  it('releases the hold when the review unmounts', () => {
    respond('widgetDetail', { error: new Error('500') });
    const onApprovalBlockedChange = vi.fn();

    const { unmount } = renderHook(() => useWidgetReview('w1', 'v2', { onApprovalBlockedChange }));
    unmount();

    expect(onApprovalBlockedChange).toHaveBeenLastCalledWith(false);
  });
});
