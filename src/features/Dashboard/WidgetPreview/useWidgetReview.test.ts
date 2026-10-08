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
  isLoading?: boolean;
  mutate: ReturnType<typeof vi.fn>;
}

/** SWR responses by key root: `dashboard:widget` / `dashboard:versions` / `dashboard:previewRun`. */
const responses = vi.hoisted(() => new Map<string, FakeResponse>());

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: (key: unknown[] | null) =>
    (key && responses.get(key[0] as string)) ?? { data: undefined, mutate: vi.fn() },
}));

const widget = { draftVersionId: 'v2', id: 'w1', title: 'Open PRs' } as any;
const versions = [
  { id: 'v1', status: 'published', version: 1 },
  { id: 'v2', status: 'draft', version: 2 },
] as any[];

const respond = (root: string, response: Omit<FakeResponse, 'mutate'>) =>
  responses.set(`dashboard:${root}`, { mutate: vi.fn(), ...response });

/** Every review request settled, with the store filled as their `onSuccess` would. */
const loadAll = () => {
  respond('widget', { data: widget });
  respond('versions', { data: versions });
  respond('previewRun', { data: null });
  useDashboardStore.setState({
    widgetDetailMap: { w1: widget },
    widgetRunsMap: { w1: [] },
    widgetVersionsMap: { w1: versions },
  });
};

beforeEach(() => {
  responses.clear();
  useDashboardStore.setState(initialState);
});

describe('useWidgetReview', () => {
  it('reports a failed load as an error, holds approval, and retries every request', () => {
    respond('widget', { error: new Error('500') });
    respond('versions', { data: versions });
    const onApprovalBlockedChange = vi.fn();

    const { result } = renderHook(() => useWidgetReview('w1', 'v2', { onApprovalBlockedChange }));

    expect(result.current.status).toBe('error');
    expect(result.current.error).toEqual(new Error('500'));
    expect(onApprovalBlockedChange).toHaveBeenLastCalledWith(true);

    act(() => result.current.retry());
    expect(responses.get('dashboard:widget')!.mutate).toHaveBeenCalled();
    expect(responses.get('dashboard:versions')!.mutate).toHaveBeenCalled();
  });

  it('holds approval while loading, including a retry in flight after a failure', () => {
    respond('widget', { error: new Error('500'), isLoading: true });
    respond('versions', { isLoading: true });
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
    respond('previewRun', { error: new Error('503') });
    const onApprovalBlockedChange = vi.fn();

    const { result } = renderHook(() =>
      useWidgetReview('w1', 'v2', { onApprovalBlockedChange, withRuns: true }),
    );

    expect(result.current.status).toBe('error');
    expect(onApprovalBlockedChange).toHaveBeenLastCalledWith(true);
    act(() => result.current.retry());
    expect(responses.get('dashboard:previewRun')!.mutate).toHaveBeenCalled();
  });

  it('loads the reviewed version’s preview by version, not the capped run list', () => {
    loadAll();
    // The approval-era preview no longer sits in the newest-run window; only
    // the version-keyed request can still see it.
    const run = { id: 'r1', versionId: 'v2' };
    respond('previewRun', { data: run });

    const { result } = renderHook(() => useWidgetReview('w1', 'v2', { withRuns: true }));

    expect(result.current.status).toBe('ready');
    expect(result.current.run).toEqual(run);
  });

  it('keeps a loaded review ready through a background revalidation failure', () => {
    loadAll();
    respond('versions', { data: versions, error: new Error('500') });

    const { result } = renderHook(() => useWidgetReview('w1', 'v2'));

    expect(result.current.status).toBe('ready');
  });

  it('releases the hold when the review unmounts', () => {
    respond('widget', { error: new Error('500') });
    const onApprovalBlockedChange = vi.fn();

    const { unmount } = renderHook(() => useWidgetReview('w1', 'v2', { onApprovalBlockedChange }));
    unmount();

    expect(onApprovalBlockedChange).toHaveBeenLastCalledWith(false);
  });
});
