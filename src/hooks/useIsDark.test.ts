import { renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';

import { useIsDark } from './useIsDark';

describe('forced embed appearance', () => {
  afterEach(() => localStorage.removeItem('theme'));

  it('switches component tokens with the forced theme without persisting a preference', () => {
    localStorage.setItem('theme', 'light');
    let forcedTheme: 'dark' | 'light' = 'dark';
    const { result, rerender } = renderHook(useIsDark, {
      wrapper: ({ children }: PropsWithChildren) =>
        createElement(NextThemeProvider, { children, forcedTheme }),
    });
    expect(result.current).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('light');

    forcedTheme = 'light';
    rerender();
    expect(result.current).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });
});
