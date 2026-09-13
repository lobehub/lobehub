/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskStore } from '@/store/task';

import { useCanonicalTaskSlug } from './useCanonicalTaskSlug';

const mocks = vi.hoisted(() => ({
  location: { hash: '', search: '' } as { hash: string; search: string },
  navigate: vi.fn(),
  params: {} as { aid?: string; slug?: string; workspaceSlug?: string },
}));

vi.mock('react-router', () => ({
  useLocation: () => mocks.location,
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: () => null,
  useActiveWorkspaceSlug: () => null,
}));

const setTaskName = (name?: string) => {
  useTaskStore.setState({
    taskDetailMap: name === undefined ? {} : ({ 'T-1': { name } } as never),
  });
};

describe('useCanonicalTaskSlug', () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.params = {};
    mocks.location = { hash: '', search: '' };
    setTaskName(undefined);
  });

  it('upgrades a bare id link to the slugged path once the title lands', () => {
    setTaskName('Ship the Thing');

    renderHook(() => useCanonicalTaskSlug('T-1'));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-1/ship-the-thing', { replace: true });
  });

  it('repairs a stale slug left by a rename or a hand-edited link', () => {
    mocks.params = { slug: 'whatever-was-pasted' };
    setTaskName('Ship the Thing');

    renderHook(() => useCanonicalTaskSlug('T-1'));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-1/ship-the-thing', { replace: true });
  });

  it('keeps the workspace prefix and agent scope of the current URL', () => {
    mocks.params = { aid: 'agt_owner', workspaceSlug: 'lobehub' };
    setTaskName('Ship the Thing');

    renderHook(() => useCanonicalTaskSlug('T-1'));

    expect(mocks.navigate).toHaveBeenCalledWith(
      '/lobehub/agent/agt_owner/task/T-1/ship-the-thing',
      {
        replace: true,
      },
    );
  });

  it('preserves the query string and hash', () => {
    mocks.location = { hash: '#activity', search: '?tab=runs' };
    setTaskName('Ship the Thing');

    renderHook(() => useCanonicalTaskSlug('T-1'));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-1/ship-the-thing?tab=runs#activity', {
      replace: true,
    });
  });

  it('drops a slug the title no longer supports', () => {
    mocks.params = { slug: 'ship-the-thing' };
    setTaskName('!!!');

    renderHook(() => useCanonicalTaskSlug('T-1'));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-1', { replace: true });
  });

  it('collapses the URL once the title is cleared', () => {
    // Regression: an empty title is a resolved state, not an unloaded one —
    // clearing the input persists `name: ''`. Treating the two alike pinned the
    // URL to the slug of the title that had just been deleted.
    mocks.params = { slug: 'ship-the-thing' };
    setTaskName('');

    renderHook(() => useCanonicalTaskSlug('T-1'));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-1', { replace: true });
  });

  it('leaves the URL alone while the title is still unknown', () => {
    mocks.params = { slug: 'an-incoming-slug' };

    renderHook(() => useCanonicalTaskSlug('T-1'));

    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when the slug already matches', () => {
    mocks.params = { slug: 'ship-the-thing' };
    setTaskName('Ship the Thing');

    renderHook(() => useCanonicalTaskSlug('T-1'));

    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
