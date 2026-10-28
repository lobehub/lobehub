import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAcceptanceRowCreator } from './useAcceptanceRowCreator';

const useAuthorInfoMock = vi.hoisted(() => vi.fn());

vi.mock('@/business/client/hooks/useAuthorInfo', () => ({
  useAuthorInfo: useAuthorInfoMock,
}));
vi.mock('@/business/client/hooks/useHasActiveWorkspace', () => ({
  useHasActiveWorkspace: () => true,
}));

describe('useAcceptanceRowCreator', () => {
  beforeEach(() => {
    useAuthorInfoMock.mockReset();
    useAuthorInfoMock.mockImplementation((userId?: string) =>
      userId === 'user-alice' ? { avatar: 'a.png', fullName: 'Alice' } : undefined,
    );
  });

  it('returns the creator when they resolve to a workspace member', () => {
    const { result } = renderHook(() => useAcceptanceRowCreator('user-alice', true));

    expect(result.current).toBe('user-alice');
  });

  it('falls back to the status glyph when the creator does not resolve (personal mode)', () => {
    const { result } = renderHook(() => useAcceptanceRowCreator('user-bob', true));

    expect(result.current).toBeUndefined();
  });

  it('skips the creator when the list only holds the viewer own acceptances', () => {
    const { result } = renderHook(() => useAcceptanceRowCreator('user-alice', false));

    expect(result.current).toBeUndefined();
    expect(useAuthorInfoMock).not.toHaveBeenCalledWith('user-alice');
  });
});
