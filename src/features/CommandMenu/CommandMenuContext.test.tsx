import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CommandMenuProvider, useCommandMenuContext } from './CommandMenuContext';

const createWrapper = () => {
  const onClose = vi.fn();

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <CommandMenuProvider pathname="/" onClose={onClose}>
      {children}
    </CommandMenuProvider>
  );

  return Wrapper;
};

describe('CommandMenuProvider', () => {
  it('should promote inline type filters into command menu state', () => {
    const { result } = renderHook(() => useCommandMenuContext(), { wrapper: createWrapper() });

    act(() => {
      result.current.setSearch('type:message search content');
    });

    expect(result.current.search).toBe('search content');
    expect(result.current.typeFilter).toBe('message');
  });

  it('should keep invalid type filters as literal search text', () => {
    const { result } = renderHook(() => useCommandMenuContext(), { wrapper: createWrapper() });

    act(() => {
      result.current.setSearch('type:unknown search content');
    });

    expect(result.current.search).toBe('type:unknown search content');
    expect(result.current.typeFilter).toBeUndefined();
  });
});
