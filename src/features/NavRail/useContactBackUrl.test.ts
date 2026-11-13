import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useContactBackUrl } from './useContactBackUrl';

const imLayout = vi.hoisted(() => ({ value: false }));

vi.mock('./useImLayout', () => ({ useImLayout: () => imLayout.value }));

describe('useContactBackUrl', () => {
  it('returns to the Contacts list in the rail layout', () => {
    imLayout.value = true;
    expect(renderHook(() => useContactBackUrl()).result.current).toBe('/agents');
  });

  it('returns home in the sidebar layout', () => {
    imLayout.value = false;
    expect(renderHook(() => useContactBackUrl()).result.current).toBe('/');
  });
});
