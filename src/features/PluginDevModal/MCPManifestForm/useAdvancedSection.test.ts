import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { hasAdvancedValue, useAdvancedSectionExpanded } from './useAdvancedSection';

describe('hasAdvancedValue', () => {
  it('is false for the defaults, including OAuth with an empty client (auto-detected)', () => {
    expect(hasAdvancedValue({})).toBe(false);
    expect(hasAdvancedValue({ connectVia: 'auto', headers: {} })).toBe(false);
    expect(hasAdvancedValue({ clientId: '', clientSecret: '', isOAuth: true })).toBe(false);
  });

  it('is true for a device route, an OAuth client or headers', () => {
    expect(hasAdvancedValue({ connectVia: 'device' })).toBe(true);
    expect(hasAdvancedValue({ clientId: 'client-1', isOAuth: true })).toBe(true);
    expect(hasAdvancedValue({ clientSecret: 'secret', isOAuth: true })).toBe(true);
    expect(hasAdvancedValue({ headers: { 'X-Team': 'a' } })).toBe(true);
  });

  it('ignores an OAuth client left over from another auth type, which saving drops', () => {
    expect(hasAdvancedValue({ clientId: 'client-1', isOAuth: false })).toBe(false);
  });
});

describe('useAdvancedSectionExpanded', () => {
  it('starts collapsed without a saved value', () => {
    const { result } = renderHook(() => useAdvancedSectionExpanded(false));

    expect(result.current[0]).toBe(false);
  });

  it('starts expanded with a saved value', () => {
    const { result } = renderHook(() => useAdvancedSectionExpanded(true));

    expect(result.current[0]).toBe(true);
  });

  it('opens when a value arrives after mount, e.g. edit-mode seeding', () => {
    const { result, rerender } = renderHook(({ holds }) => useAdvancedSectionExpanded(holds), {
      initialProps: { holds: false },
    });

    rerender({ holds: true });

    expect(result.current[0]).toBe(true);
  });

  it('lets the user collapse it and does not reopen until a value appears again', () => {
    const { result, rerender } = renderHook(({ holds }) => useAdvancedSectionExpanded(holds), {
      initialProps: { holds: true },
    });

    act(() => result.current[1](false));
    rerender({ holds: true });
    expect(result.current[0]).toBe(false);

    rerender({ holds: false });
    expect(result.current[0]).toBe(false);

    rerender({ holds: true });
    expect(result.current[0]).toBe(true);
  });

  it('does not collapse when the value is cleared while open', () => {
    const { result, rerender } = renderHook(({ holds }) => useAdvancedSectionExpanded(holds), {
      initialProps: { holds: true },
    });

    rerender({ holds: false });

    expect(result.current[0]).toBe(true);
  });
});
