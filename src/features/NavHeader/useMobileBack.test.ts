import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canGoBackInApp, useMobileBack } from './useMobileBack';

const navigate = vi.fn();

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));

beforeEach(() => {
  navigate.mockClear();
  window.history.replaceState(null, '');
});

describe('canGoBackInApp', () => {
  it('is false on the entry page of the session', () => {
    window.history.replaceState({ idx: 0 }, '');
    expect(canGoBackInApp()).toBe(false);
  });

  it('is false without router history state (deep link before the router wrote any)', () => {
    expect(canGoBackInApp()).toBe(false);
  });

  it('is true once the user navigated in-app', () => {
    window.history.replaceState({ idx: 3 }, '');
    expect(canGoBackInApp()).toBe(true);
  });
});

describe('useMobileBack', () => {
  it('goes back in history when the page was reached in-app', () => {
    window.history.replaceState({ idx: 1 }, '');

    renderHook(() => useMobileBack()).result.current();

    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('falls back to home for a page opened directly', () => {
    renderHook(() => useMobileBack()).result.current();

    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('uses the given fallback', () => {
    renderHook(() => useMobileBack('/tasks')).result.current();

    expect(navigate).toHaveBeenCalledWith('/tasks');
  });
});
