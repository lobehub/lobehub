import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useQueryRoute } from './useQueryRoute';

const navigateMock = vi.hoisted(() => vi.fn((href: string) => href));
const activeWorkspaceSlugMock = vi.hoisted(() => vi.fn<() => string | null>(() => null));

// Mocks
vi.mock('react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: activeWorkspaceSlugMock,
}));

vi.mock('@/utils/env', () => ({
  isOnServerSide: false,
}));

beforeEach(() => {
  location.search = 'foo=bar';
  activeWorkspaceSlugMock.mockReset();
  activeWorkspaceSlugMock.mockReturnValue(null);
  navigateMock.mockReset();
  navigateMock.mockImplementation((href: string) => href);
});

describe('useQueryRoute', () => {
  it('should generate correct href without hash and replace', () => {
    const { result } = renderHook(() =>
      useQueryRoute().push('/example', {
        query: { baz: 'qux' },
      }),
    );

    expect(result.current).toBe('/example?baz=qux&foo=bar');
  });

  it('should replace entire query string when replace is true', () => {
    const { result } = renderHook(() =>
      useQueryRoute().push('/example', {
        replace: true,
        query: { baz: 'qux' },
      }),
    );

    expect(result.current).toBe('/example?baz=qux');
  });

  it('should append hash to the URL', () => {
    const { result } = renderHook(() =>
      useQueryRoute().push('/example', {
        replace: true,
        query: { foo: 'bar' },
        hash: 'section1',
      }),
    );

    expect(result.current).toBe('/example?foo=bar#section1');
  });

  it('should handle scenarios when on server side', () => {
    const { result } = renderHook(() =>
      useQueryRoute().push('/example', {
        query: { foo: 'bar' },
        hash: 'section1',
      }),
    );

    expect(result.current).toBe('/example?foo=bar#section1');
  });

  it('should handle cases with empty query and hash', () => {
    const { result } = renderHook(() =>
      useQueryRoute().replace('/example', {
        replace: true,
        query: {},
        hash: '',
      }),
    );

    expect(result.current).toBe('/example');
  });

  it('should handle cases without hash when on server side', () => {
    const { result } = renderHook(() =>
      useQueryRoute().replace('/example', {
        query: { foo: 'bar' },
      }),
    );

    expect(result.current).toBe('/example?foo=bar');
  });

  it('should preserve the active workspace prefix for agent topics', () => {
    activeWorkspaceSlugMock.mockReturnValue('team');

    const { result } = renderHook(() => useQueryRoute().push('/agent/agent-1/topics'));

    expect(result.current).toBe('/team/agent/agent-1/topics?foo=bar');
  });
});
