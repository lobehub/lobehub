/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';

import { readAcceptanceTurn, useAcceptanceTurn } from './useAcceptanceTurn';

describe('Acceptance round links', () => {
  it('maps a shared r link to the Acceptance turn and preserves unrelated query state', () => {
    const { result } = renderHook(
      () => ({ ...useAcceptanceTurn(), search: useLocation().search }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(MemoryRouter, {
            initialEntries: ['/acceptance/id?r=2&filter=all'],
            children,
          }),
      },
    );
    expect(result.current.turn).toBe(2);
    expect(result.current.search).toBe('?filter=all&turn=2');
    act(() => result.current.setTurn(1));
    expect(result.current.search).toBe('?turn=1');
    act(() => result.current.setTurn(null));
    expect(result.current.search).toBe('');
  });
  it('keeps embedded round selection local to its host', () => {
    const { result } = renderHook(
      () => ({ ...useAcceptanceTurn(true), search: useLocation().search }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(MemoryRouter, { initialEntries: ['/chat?r=7'], children }),
      },
    );
    expect(result.current.turn).toBeNull();
    act(() => result.current.setTurn(2));
    expect(result.current.turn).toBe(2);
    expect(result.current.search).toBe('?r=7');
  });
  it('does not mistake an explicit report request for a turn link', () => {
    expect(readAcceptanceTurn(new URLSearchParams('report=2'))).toBeNull();
    expect(readAcceptanceTurn(new URLSearchParams('turn=3&r=2'))).toBe(3);
    for (const value of ['0', '-1', '1.5', 'NaN', '9007199254740992'])
      expect(readAcceptanceTurn(new URLSearchParams(`r=${value}`))).toBeNull();
  });
});
