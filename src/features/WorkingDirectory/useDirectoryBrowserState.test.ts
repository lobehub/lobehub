import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDirectoryBrowserState } from './useDirectoryBrowserState';

describe('directory browser path drafts', () => {
  it('closes folder creation and disallows directory actions when the displayed path changes', () => {
    const { result } = renderHook(() => useDirectoryBrowserState('/loaded'));
    expect(result.current.isPathConfirmed('/loaded')).toBe(true);
    act(() => result.current.setCreatingFolder(true));
    act(() => result.current.editPath('/draft'));
    expect(result.current.creatingFolder).toBe(false);
    expect(result.current.isPathConfirmed('/loaded')).toBe(false);
    expect(result.current.path).toBe('/loaded');

    act(() => result.current.navigate('/draft'));
    expect(result.current.draft).toBeUndefined();
    expect(result.current.path).toBe('/draft');
    expect(result.current.isPathConfirmed('/draft')).toBe(true);
  });

  it('requires a loaded directory, and accepts a draft matching its normalized path', () => {
    const { result } = renderHook(() => useDirectoryBrowserState('/loaded'));
    expect(result.current.isPathConfirmed()).toBe(false);
    act(() => result.current.editPath(' /loaded '));
    expect(result.current.isPathConfirmed('/loaded')).toBe(true);
  });
});
