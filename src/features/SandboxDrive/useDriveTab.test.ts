import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';

import { useDriveTab } from './useDriveTab';

const renderAt = (url: string, drives: ('public' | 'personal')[]) =>
  renderHook(() => ({ location: useLocation(), tab: useDriveTab(drives) }), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, { initialEntries: [url] }, children),
  });

describe('useDriveTab', () => {
  it('opens the drive named in ?drive', () => {
    const { result } = renderAt('/settings/drive?drive=personal', ['public', 'personal']);

    expect(result.current.tab[0]).toBe('personal');
  });

  it('falls back to the first drive offered for a missing or unknown value', () => {
    expect(renderAt('/settings/drive', ['public', 'personal']).result.current.tab[0]).toBe(
      'public',
    );
    expect(
      renderAt('/settings/drive?drive=nope', ['public', 'personal']).result.current.tab[0],
    ).toBe('public');
    // A personal account has no public drive to land on.
    expect(renderAt('/settings/drive?drive=public', ['personal']).result.current.tab[0]).toBe(
      'personal',
    );
  });

  it('writes the chosen drive into the URL and keeps other params', () => {
    const { result } = renderAt('/settings/drive?keep=1', ['public', 'personal']);

    act(() => result.current.tab[1]('personal'));

    const search = new URLSearchParams(result.current.location.search);
    expect(result.current.tab[0]).toBe('personal');
    expect(search.get('drive')).toBe('personal');
    expect(search.get('keep')).toBe('1');
  });
});
